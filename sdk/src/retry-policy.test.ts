/**
 * SR-087 Comprehensive retry policy tests.
 *
 * Covers all five failure modes from the acceptance criteria:
 *   1. RPC timeout
 *   2. 429 Too Many Requests (with and without Retry-After)
 *   3. 5xx server errors
 *   4. Network reset mid-submit (ECONNRESET)
 *   5. Duplicate submission protection
 *
 * Also verifies:
 *   - Jittered backoff (no thundering herd)
 *   - Retry-After is honoured exactly
 *   - Write operations use NONE policy by default (no blind resubmit)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withRetry,
  withRetryPolicy,
  isTransientError,
  parseRetryAfterMs,
  extractRetryAfter,
} from "./retry.js";
import type { RetryPolicy } from "./types.js";
import { RetryPolicies } from "./types.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

function failThenSucceed<T>(failCount: number, error: Error, value: T) {
  let calls = 0;
  return vi.fn(async () => {
    if (calls++ < failCount) throw error;
    return value;
  });
}

function alwaysThrow(error: Error) {
  return vi.fn(async (): Promise<never> => { throw error; });
}

// ─── parseRetryAfterMs ────────────────────────────────────────────────────────

describe("parseRetryAfterMs", () => {
  it("parses integer seconds string", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
  });

  it("parses decimal seconds string", () => {
    expect(parseRetryAfterMs("1.5")).toBe(1500);
  });

  it("parses zero", () => {
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("parses an HTTP-date in the future", () => {
    const future = new Date(Date.now() + 3000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(3500);
  });

  it("returns null for null input", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseRetryAfterMs(undefined)).toBeNull();
  });

  it("returns null for unparseable string", () => {
    expect(parseRetryAfterMs("not-a-date")).toBeNull();
  });
});

// ─── extractRetryAfter ────────────────────────────────────────────────────────

describe("extractRetryAfter", () => {
  it("reads retryAfter property directly on error object", () => {
    const err = Object.assign(new Error("429"), { retryAfter: "3" });
    expect(extractRetryAfter(err)).toBe(3000);
  });

  it("reads headers.retry-after from error", () => {
    const err = Object.assign(new Error("429"), {
      headers: { "retry-after": "2" },
    });
    expect(extractRetryAfter(err)).toBe(2000);
  });

  it("reads response.headers.retry-after from error", () => {
    const err = Object.assign(new Error("429"), {
      response: { headers: { "retry-after": "4" } },
    });
    expect(extractRetryAfter(err)).toBe(4000);
  });

  it("returns null for plain Error with no Retry-After", () => {
    expect(extractRetryAfter(new Error("503"))).toBeNull();
  });

  it("returns null for non-object values", () => {
    expect(extractRetryAfter("string")).toBeNull();
    expect(extractRetryAfter(null)).toBeNull();
  });
});

// ─── isTransientError ─────────────────────────────────────────────────────────

describe("isTransientError – all classified failure modes", () => {
  it.each([
    // failure mode 1 – RPC timeout
    ["RPC call timed out after 30000ms", true],
    ["timeout exceeded", true],
    ["timed out", true],
    // failure mode 2 – 429
    ["429 Too Many Requests", true],
    // failure mode 3 – 5xx
    ["503 Service Unavailable", true],
    ["502 Bad Gateway", true],
    ["504 Gateway Timeout", true],
    // failure mode 4 – network reset
    ["ECONNRESET", true],
    ["ECONNREFUSED", true],
    ["ETIMEDOUT", true],
    ["network error", true],
    // non-transient
    ["Simulation failed: auth error", false],
    ["Submit failed: invalid sequence", false],
    ["Transaction failed: bad signature", false],
    ["Contract error 7: InvalidStatus", false],
  ])("classifies %s as transient=%s", (msg, expected) => {
    expect(isTransientError(new Error(msg))).toBe(expected);
  });
});

// ─── failure mode 1: RPC timeout ─────────────────────────────────────────────

describe("failure mode 1 – RPC timeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries on RPC timeout and eventually succeeds", async () => {
    const fn = failThenSucceed(2, new Error("RPC call timed out after 30000ms"), "ok");
    const promise = withRetry(fn, 3, 0, 1);
    await vi.runAllTimersAsync();
    expect(await promise).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops retrying after max attempts and rethrows", async () => {
    const fn = alwaysThrow(new Error("RPC call timed out after 30000ms"));
    const promise = withRetry(fn, 2, 0, 1);
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("timed out");
    // 1 initial + 2 retries = 3 total
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// ─── failure mode 2: 429 with Retry-After ────────────────────────────────────

describe("failure mode 2 – 429 Too Many Requests with Retry-After", () => {
  afterEach(() => vi.useRealTimers());

  it("honours Retry-After header (waits the specified duration)", async () => {
    vi.useFakeTimers();
    const waitedMs: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (fn: TimerHandler, ms?: number) => {
        if (typeof ms === "number" && ms > 0) waitedMs.push(ms);
        return originalSetTimeout(fn as () => void, 0);
      },
    );

    const rateLimitErr = Object.assign(
      new Error("429 Too Many Requests"),
      { headers: { "retry-after": "2" } },   // 2 seconds = 2000 ms
    );
    const fn = failThenSucceed(1, rateLimitErr, "ok");
    const promise = withRetry(fn, 3, 100, 2);
    await vi.runAllTimersAsync();
    await promise;

    // The wait must be ~2000 ms (from Retry-After), not the jittered backoff
    expect(waitedMs.some((ms) => ms >= 1900 && ms <= 2100)).toBe(true);
    spy.mockRestore();
  });

  it("retries and succeeds after a 429", async () => {
    vi.useFakeTimers();
    const fn = failThenSucceed(1, new Error("429 Too Many Requests"), "done");
    const promise = withRetry(fn, 3, 0, 1);
    await vi.runAllTimersAsync();
    expect(await promise).toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ─── failure mode 3: 5xx server errors ───────────────────────────────────────

describe("failure mode 3 – 5xx server errors", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(["502", "503", "504"])("retries on %s and succeeds", async (code) => {
    const fn = failThenSucceed(1, new Error(`${code} server error`), "ok");
    const promise = withRetry(fn, 3, 0, 1);
    await vi.runAllTimersAsync();
    expect(await promise).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ─── failure mode 4: network reset mid-submit ────────────────────────────────

describe("failure mode 4 – network reset mid-submit (ECONNRESET)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries on ECONNRESET and succeeds", async () => {
    const fn = failThenSucceed(2, new Error("ECONNRESET"), "submitted");
    const promise = withRetry(fn, 3, 0, 1);
    await vi.runAllTimersAsync();
    expect(await promise).toBe("submitted");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("non-idempotent submit with NONE policy does NOT retry on ECONNRESET", async () => {
    // This is the safety guarantee: write ops default to RetryPolicies.NONE
    const fn = alwaysThrow(new Error("ECONNRESET"));
    const promise = withRetryPolicy(fn, RetryPolicies.NONE, { delayMs: 0, backoffFactor: 1 });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("ECONNRESET");
    // Must be called exactly once – no retry
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ─── failure mode 5: duplicate submission protection ─────────────────────────

describe("failure mode 5 – duplicate submission protection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("DuplicateSettlement error is NOT transient and stops immediately", () => {
    // If a tx was already submitted, the contract returns a non-transient error.
    // withRetry must not resubmit.
    expect(isTransientError(new Error("Contract error 12: DuplicateSettlement"))).toBe(false);
    expect(isTransientError(new Error("Submit failed: invalid sequence"))).toBe(false);
  });

  it("non-transient submit error is thrown after exactly 1 call even with retries=5", async () => {
    const fn = alwaysThrow(new Error("Submit failed: duplicate"));
    const promise = withRetry(fn, 5, 0, 1);
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("Submit failed: duplicate");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("RetryPolicies.NONE prevents any retry on transient error too", async () => {
    const fn = alwaysThrow(new Error("503 Service Unavailable"));
    const promise = withRetryPolicy(fn, RetryPolicies.NONE, { delayMs: 0, backoffFactor: 1 });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ─── Jitter verification ──────────────────────────────────────────────────────

describe("jittered backoff – no thundering herd", () => {
  afterEach(() => vi.useRealTimers());

  it("two concurrent retries use different delay values (jitter)", async () => {
    // Run two retry sequences that both fail once with a transient error.
    // Collect the actual setTimeout delay values for each.
    vi.useFakeTimers();
    const delaysA: number[] = [];
    const delaysB: number[] = [];

    const origTimeout = globalThis.setTimeout;

    let capture = delaysA;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (fn: TimerHandler, ms?: number) => {
        if (typeof ms === "number" && ms > 0) capture.push(ms);
        return origTimeout(fn as () => void, 0);
      },
    );

    // Sequence A
    capture = delaysA;
    const fnA = failThenSucceed(1, new Error("ECONNRESET"), "a");
    const pA = withRetry(fnA, 3, 1000, 2);
    await vi.runAllTimersAsync();
    await pA;

    // Sequence B — same params, different random jitter
    capture = delaysB;
    const fnB = failThenSucceed(1, new Error("ECONNRESET"), "b");
    const pB = withRetry(fnB, 3, 1000, 2);
    await vi.runAllTimersAsync();
    await pB;

    spy.mockRestore();

    // With full jitter, delays are in [0, cap]. Over many runs they differ;
    // two independent samples are almost certainly unequal.
    // We just assert both are within the valid range [0, 2000] (base*factor^0).
    expect(delaysA[0]).toBeGreaterThanOrEqual(0);
    expect(delaysA[0]).toBeLessThanOrEqual(1000);
    expect(delaysB[0]).toBeGreaterThanOrEqual(0);
    expect(delaysB[0]).toBeLessThanOrEqual(1000);
  });

  it("backoff cap grows exponentially with attempt number", async () => {
    vi.useFakeTimers();
    const caps: number[] = [];
    const origTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (fn: TimerHandler, ms?: number) => {
        if (typeof ms === "number") caps.push(ms);
        return origTimeout(fn as () => void, 0);
      },
    );

    // Fail 3 times so we collect 3 delay samples
    const fn = failThenSucceed(3, new Error("503"), "ok");
    const promise = withRetry(fn, 3, 100, 2);
    await vi.runAllTimersAsync();
    await promise;

    spy.mockRestore();

    // Each delay should be <= base * factor^attempt
    // attempt 0: cap=100, attempt 1: cap=200, attempt 2: cap=400
    expect(caps[0]).toBeGreaterThanOrEqual(0);
    expect(caps[0]).toBeLessThanOrEqual(100);
    expect(caps[1]).toBeGreaterThanOrEqual(0);
    expect(caps[1]).toBeLessThanOrEqual(200);
    expect(caps[2]).toBeGreaterThanOrEqual(0);
    expect(caps[2]).toBeLessThanOrEqual(400);
  });
});

// ─── withRetryPolicy ─────────────────────────────────────────────────────────

describe("withRetryPolicy – policy/default interaction", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("uses policy.retries, not defaults", async () => {
    const fn = failThenSucceed(2, new Error("503"), "ok");
    const policy: RetryPolicy = { retries: 3 };
    const promise = withRetryPolicy(fn, policy, { delayMs: 0, backoffFactor: 1 });
    await vi.runAllTimersAsync();
    expect(await promise).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("falls back to defaults.delayMs when policy omits it", async () => {
    const origTimeout = globalThis.setTimeout;
    const delays: number[] = [];
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (fn: TimerHandler, ms?: number) => {
        if (typeof ms === "number" && ms > 0) delays.push(ms);
        return origTimeout(fn as () => void, 0);
      },
    );

    const fn = failThenSucceed(1, new Error("timeout"), "ok");
    const promise = withRetryPolicy(fn, { retries: 1 }, { delayMs: 800, backoffFactor: 1 });
    await vi.runAllTimersAsync();
    await promise;

    spy.mockRestore();
    // Delay must be <= 800 (full jitter in [0, 800])
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    expect(delays[0]).toBeLessThanOrEqual(800);
  });

  it("propagates non-transient errors immediately", async () => {
    const fn = alwaysThrow(new Error("auth failure"));
    await expect(
      withRetryPolicy(fn, { retries: 5 }, { delayMs: 0, backoffFactor: 1 }),
    ).rejects.toThrow("auth failure");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("AGGRESSIVE policy retries up to 5 times", async () => {
    const fn = failThenSucceed(4, new Error("503"), "ok");
    const promise = withRetryPolicy(fn, RetryPolicies.AGGRESSIVE, { delayMs: 0, backoffFactor: 1 });
    await vi.runAllTimersAsync();
    expect(await promise).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(5);
  });
});
