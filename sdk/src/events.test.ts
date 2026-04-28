import { describe, it, expect, vi, beforeEach } from "vitest";
import { SwiftRemitClient } from "./client.js";
import { xdr, scValToNative } from "@stellar/stellar-sdk";

// Minimal mock of SorobanRpc.Server
const mockGetEvents = vi.fn();

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: class {
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

  it("returns an unsubscribe function", () => {
    mockGetEvents.mockResolvedValue({ events: [] });
    const unsub = client.subscribeToRemittanceEvents(() => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("calls callback with typed events", async () => {
    const received: Array<{ type: string; remittanceId: bigint }> = [];

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
    const received: bigint[] = [];

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
