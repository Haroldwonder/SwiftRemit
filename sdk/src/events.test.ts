import { describe, it, expect, vi, beforeEach } from "vitest";
import { SwiftRemitClient } from "./client.js";
import { xdr, scValToNative } from "@stellar/stellar-sdk";

// Minimal mock of SorobanRpc.Server
const mockGetEvents = vi.fn();
const mockServerConstructor = vi.fn();

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: {
      ...((actual as unknown as Record<string, unknown>)["rpc"] as object),
      Server: class {
        constructor(...args: unknown[]) {
          mockServerConstructor(...args);
        }
        getEvents = mockGetEvents;
        getAccount = vi.fn();
        simulateTransaction = vi.fn();
        sendTransaction = vi.fn();
        getTransaction = vi.fn();
      },
    },
  };
});

function makeEvent(type: string, remittanceId: bigint, pagingToken: string) {
  return {
    pagingToken,
    ledger: 1000,
    ledgerClosedAt: "2026-04-26T00:00:00Z",
    topic: [
      xdr.ScVal.scvSymbol(type),
      xdr.ScVal.scvU64(xdr.Uint64.fromString(remittanceId.toString())),
    ],
    value: xdr.ScVal.scvVoid(),
    contractId: "CTEST",
    id: pagingToken,
    type: "contract",
  };
}

describe("subscribeToRemittanceEvents", () => {
  let client: SwiftRemitClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SwiftRemitClient({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
    });
  });

  it("disables allowHttp for non-local HTTPS endpoints", () => {
    expect(mockServerConstructor).toHaveBeenCalledWith(
      "https://soroban-testnet.stellar.org",
      { allowHttp: false }
    );
  });

  it("allows localhost HTTP endpoints and warns once", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    new SwiftRemitClient({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "http://localhost:8000",
    });

    expect(mockServerConstructor).toHaveBeenLastCalledWith(
      "http://localhost:8000",
      { allowHttp: true }
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Using insecure HTTP RPC connection")
    );
    warnSpy.mockRestore();
  });

  it("returns an unsubscribe function", () => {
    mockGetEvents.mockResolvedValue({ events: [] });
    const unsub = client.subscribeToRemittanceEvents(() => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("calls callback with typed events", async () => {
    const received: Array<{ type: string; remittanceId: bigint | undefined }> = [];

    mockGetEvents
      .mockResolvedValueOnce({
        events: [makeEvent("created", 1n, "tok-1"), makeEvent("completed", 1n, "tok-2")],
      })
      .mockResolvedValue({ events: [] });

    const unsub = client.subscribeToRemittanceEvents((event) => {
      received.push({ type: event.type, remittanceId: event.remittanceId });
    });

    // Allow the first poll to complete
    await new Promise((r) => setTimeout(r, 50));
    unsub();

    expect(received).toContainEqual({ type: "created", remittanceId: 1n });
    expect(received).toContainEqual({ type: "completed", remittanceId: 1n });
  });

  it("filters by remittanceId", async () => {
    const received: Array<bigint | undefined> = [];

    mockGetEvents
      .mockResolvedValueOnce({
        events: [makeEvent("created", 1n, "tok-1"), makeEvent("created", 2n, "tok-2")],
      })
      .mockResolvedValue({ events: [] });

    const unsub = client.subscribeToRemittanceEvents(
      (event) => received.push(event.remittanceId),
      { remittanceId: 1n }
    );

    await new Promise((r) => setTimeout(r, 50));
    unsub();

    expect(received).toEqual([1n]);
    expect(received).not.toContain(2n);
  });

  it("reconnects after stream error", async () => {
    mockGetEvents
      .mockRejectedValueOnce(new Error("SSE disconnect"))
      .mockResolvedValue({ events: [] });

    const unsub = client.subscribeToRemittanceEvents(() => {});

    // Wait long enough for reconnect (1 s delay + poll)
    await new Promise((r) => setTimeout(r, 1_200));
    unsub();

    // Should have been called at least twice (initial fail + reconnect)
    expect(mockGetEvents.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("unsubscribe stops further polling", async () => {
    mockGetEvents.mockResolvedValue({ events: [] });

    const unsub = client.subscribeToRemittanceEvents(() => {});
    await new Promise((r) => setTimeout(r, 50));
    const callsBeforeUnsub = mockGetEvents.mock.calls.length;
    unsub();

    await new Promise((r) => setTimeout(r, 6_000));
    // No additional polls after unsubscribe
    expect(mockGetEvents.mock.calls.length).toBe(callsBeforeUnsub);
  }, 10_000);
});

describe("on / onAny decoded payloads", () => {
  let client: SwiftRemitClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SwiftRemitClient({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
    });
  });

  it("on() delivers a decoded payload, not raw base64 XDR", async () => {
    const received: Array<{ remittanceId: bigint; value: unknown; topics: unknown[] }> = [];

    const event = makeEvent("created", 7n, "tok-1");
    event.value = xdr.ScVal.scvVec([
      xdr.ScVal.scvU32(1),
      xdr.ScVal.scvU64(xdr.Uint64.fromString("7")),
    ]);

    mockGetEvents.mockResolvedValueOnce({ events: [event] }).mockResolvedValue({ events: [] });

    const unsub = client.on("created", (e) => {
      received.push({
        remittanceId: e.data.remittanceId,
        value: e.data.value,
        topics: e.data.topics,
      });
    });

    await new Promise((r) => setTimeout(r, 50));
    unsub();

    expect(received).toHaveLength(1);
    expect(received[0].remittanceId).toBe(7n);
    expect(received[0].value).toEqual([1, 7n]);
    expect(received[0].topics[0]).toBe("created");
  });

  it("on() still exposes the raw base64 XDR under data.raw", async () => {
    const received: Array<{ topics: string[]; value: string }> = [];

    mockGetEvents
      .mockResolvedValueOnce({ events: [makeEvent("completed", 3n, "tok-1")] })
      .mockResolvedValue({ events: [] });

    const unsub = client.on("completed", (e) => received.push(e.data.raw));

    await new Promise((r) => setTimeout(r, 50));
    unsub();

    expect(received).toHaveLength(1);
    expect(typeof received[0].value).toBe("string");
    expect(scValToNative(xdr.ScVal.fromXDR(received[0].topics[0], "base64"))).toBe("completed");
  });

  it("on() ignores events of other types", async () => {
    const received: string[] = [];

    mockGetEvents
      .mockResolvedValueOnce({
        events: [makeEvent("created", 1n, "tok-1"), makeEvent("completed", 1n, "tok-2")],
      })
      .mockResolvedValue({ events: [] });

    const unsub = client.on("created", (e) => received.push(e.type));

    await new Promise((r) => setTimeout(r, 50));
    unsub();

    expect(received).toEqual(["created"]);
  });

  it("onAny() delivers decoded payloads for each subscribed type", async () => {
    const received: Array<{ type: string; remittanceId: bigint | undefined; value: unknown }> = [];

    const created = makeEvent("created", 1n, "tok-1");
    created.value = xdr.ScVal.scvU32(11);
    const completed = makeEvent("completed", 2n, "tok-2");
    completed.value = xdr.ScVal.scvU32(22);

    mockGetEvents
      .mockResolvedValueOnce({
        events: [created, completed, makeEvent("cancelled", 3n, "tok-3")],
      })
      .mockResolvedValue({ events: [] });

    const unsub = client.onAny(["created", "completed"], (e) => {
      received.push({ type: e.type, remittanceId: e.data.remittanceId, value: e.data.value });
    });

    await new Promise((r) => setTimeout(r, 50));
    unsub();

    expect(received).toEqual([
      { type: "created", remittanceId: 1n, value: 11 },
      { type: "completed", remittanceId: 2n, value: 22 },
    ]);
  });

  it("skips remittance-scoped events with no decodable remittance ID", async () => {
    const received: bigint[] = [];

    const malformed = makeEvent("created", 1n, "tok-1");
    // Drop the ID topic so the event carries no remittance ID at all.
    malformed.topic = [malformed.topic[0]];

    mockGetEvents
      .mockResolvedValueOnce({ events: [malformed, makeEvent("created", 9n, "tok-2")] })
      .mockResolvedValue({ events: [] });

    const unsub = client.on("created", (e) => received.push(e.data.remittanceId));

    await new Promise((r) => setTimeout(r, 50));
    unsub();

    expect(received).toEqual([9n]);
  });

  it("delivers contract-wide events that carry no remittance ID", async () => {
    const received: Array<{ type: string; topics: unknown[] }> = [];

    const paused = makeEvent("paused", 0n, "tok-1");
    paused.topic = [paused.topic[0]];

    mockGetEvents.mockResolvedValueOnce({ events: [paused] }).mockResolvedValue({ events: [] });

    const unsub = client.on("paused", (e) => {
      received.push({ type: e.type, topics: e.data.topics });
    });

    await new Promise((r) => setTimeout(r, 50));
    unsub();

    expect(received).toHaveLength(1);
    expect(received[0].topics).toEqual(["paused"]);
  });
});
