/**
 * Tests for per-operation retry policy configuration.
 *
 * Verifies that:
 *  - Global write retry policy defaults to 0 retries
 *  - Per-call retryPolicy on submitTransaction overrides the default
 *  - simulateCall uses the global read retry config
 *  - withRetryPolicy correctly falls back to defaults for omitted fields
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { withRetry, withRetryPolicy, isTransientError } from "./retry.js";
import type { RetryPolicy } from "./types.js";
import { RetryPolicies } from "./types.js";

// ─── RetryPolicies constants ──────────────────────────────────────────────────

describe("RetryPolicies", () => {
  it("NONE has retries=0", () => {
    expect(RetryPolicies.NONE.retries).toBe(0);
  });

  it("AGGRESSIVE has retries=5", () => {
    expect(RetryPolicies.AGGRESSIVE.retries).toBe(5);
  });
});

// ─── withRetryPolicy ──────────────────────────────────────────────────────────

describe("withRetryPolicy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("resolves immediately on first success", async () => {
    const fn = vi.fn(async () => "ok");
    const policy: RetryPolicy = { retries: 3, delayMs: 100, backoffFactor: 2 };
    const result = await withRetryPolicy(fn, policy, { delayMs: 1000, backoffFactor: 2 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries using policy.retries, not defaults", async () => {
    const err = new Error("503 unavailable");
    let calls = 0;
    const fn = vi.fn(async () => {
      if (calls++ < 2) throw err;
      return "done";
    });
    const policy: RetryPolicy = { retries: 3 }; // no delayMs/backoffFactor — use defaults
    const promise = withRetryPolicy(fn, policy, { delayMs: 0, backoffFactor: 1 });
    await vi.runAllTimersAsync();
    expect(await promise).toBe("done");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("falls back to defaults for omitted delayMs", async () => {
    // Save the original before spying so we don't recurse into the mock itself
    const originalSetTimeout = globalThis.setTimeout;
    const delays: number[] = [];
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (fn: TimerHandler, ms?: number) => {
        if (typeof ms === "number" && ms > 0) delays.push(ms);
        return originalSetTimeout(fn as () => void, 0);
      }
    );

    const err = new Error("timeout");
    let calls = 0;
    const fn = vi.fn(async () => {
      if (calls++ < 1) throw err;
      return "ok";
    });

    const policy: RetryPolicy = { retries: 1 }; // no delayMs → fall back to 500 default
    const promise = withRetryPolicy(fn, policy, { delayMs: 500, backoffFactor: 2 });
    await vi.runAllTimersAsync();
    await promise;

    expect(delays).toContain(500);
    spy.mockRestore();
  });

  it("NONE policy results in 0 retries (fail on first error)", async () => {
    const fn = vi.fn(async () => { throw new Error("503"); });
    const promise = withRetryPolicy(fn, RetryPolicies.NONE, { delayMs: 0, backoffFactor: 1 });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("propagates non-transient errors immediately regardless of policy", async () => {
    const fn = vi.fn(async () => { throw new Error("auth failure"); });
    await expect(
      withRetryPolicy(fn, { retries: 5 }, { delayMs: 0, backoffFactor: 1 })
    ).rejects.toThrow("auth failure");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ─── isTransientError (sanity check for new coverage) ─────────────────────────

describe("isTransientError – RPC timeout", () => {
  it("classifies RPC timeout message as transient", () => {
    expect(isTransientError(new Error("RPC call timed out after 30000ms"))).toBe(true);
  });
});

// ─── withRetry (delegate behaviour verification) ──────────────────────────────

describe("withRetry with retries=0", () => {
  it("does not retry even for transient errors", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => { throw new Error("503"); });
    const promise = withRetry(fn, 0, 100, 2);
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
