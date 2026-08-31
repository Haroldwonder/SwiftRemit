/**
 * SR-198 Confirmation-polling bounds.
 *
 * `submitSignedTransaction` polls `getTransaction` until the transaction reaches
 * a terminal status. These tests pin the two bounds that stop that loop running
 * forever when the network drops a transaction: the wall-clock deadline and the
 * hard poll cap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SwiftRemitClient, MAX_CONFIRMATION_POLLS } from "./client.js";
import { TransactionTimeoutError } from "./errors.js";
import type { Transaction } from "@stellar/stellar-sdk";

const mockSendTransaction = vi.fn();
const mockGetTransaction = vi.fn();

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: {
      ...((actual as unknown as Record<string, unknown>)["rpc"] as object),
      Server: class {
        sendTransaction = mockSendTransaction;
        getTransaction = mockGetTransaction;
        getAccount = vi.fn();
        simulateTransaction = vi.fn();
        getEvents = vi.fn();
      },
    },
  };
});

function makeClient(): SwiftRemitClient {
  return new SwiftRemitClient({
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
  });
}

// The transaction is never inspected — sendTransaction is mocked out entirely.
const fakeTx = {} as Transaction;

describe("submitSignedTransaction confirmation bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "abc123" });
    mockGetTransaction.mockResolvedValue({ status: "NOT_FOUND" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with TransactionTimeoutError when the tx never confirms", async () => {
    const client = makeClient();
    const promise = client.submitSignedTransaction(fakeTx, { maxWaitMs: 5_000 });
    const assertion = expect(promise).rejects.toThrow(TransactionTimeoutError);

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it("reports the hash and poll count on the timeout error", async () => {
    const client = makeClient();
    const promise = client.submitSignedTransaction(fakeTx, { maxWaitMs: 5_000 });
    const assertion = promise.catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(30_000);
    const err = await assertion;

    expect(err).toBeInstanceOf(TransactionTimeoutError);
    const timeout = err as TransactionTimeoutError;
    expect(timeout.hash).toBe("abc123");
    expect(timeout.polls).toBeGreaterThan(1);
    expect(timeout.waitedMs).toBeGreaterThanOrEqual(5_000);
  });

  it("stops polling once the bound is hit rather than looping forever", async () => {
    const client = makeClient();
    const promise = client.submitSignedTransaction(fakeTx, { maxWaitMs: 5_000 });
    const assertion = promise.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;

    const callsAfterTimeout = mockGetTransaction.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockGetTransaction.mock.calls.length).toBe(callsAfterTimeout);
    // ~1 poll per second against a 5 s budget — nowhere near the hard cap.
    expect(callsAfterTimeout).toBeLessThan(MAX_CONFIRMATION_POLLS);
  });

  it("returns normally when the transaction confirms before the bound", async () => {
    mockGetTransaction
      .mockResolvedValueOnce({ status: "NOT_FOUND" })
      .mockResolvedValue({ status: "SUCCESS", returnValue: undefined });

    const client = makeClient();
    const promise = client.submitSignedTransaction(fakeTx, { maxWaitMs: 30_000 });

    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    expect(result.status).toBe("SUCCESS");
  });

  it("applies the default wait budget when maxWaitMs is omitted", async () => {
    const client = makeClient();
    const promise = client.submitSignedTransaction(fakeTx);
    const assertion = promise.catch((err: unknown) => err);

    // Still polling well past the 5 s used by the explicit-bound tests.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockGetTransaction.mock.calls.length).toBeGreaterThan(20);

    await vi.advanceTimersByTimeAsync(120_000);
    const err = await assertion;

    expect(err).toBeInstanceOf(TransactionTimeoutError);
  });
});
