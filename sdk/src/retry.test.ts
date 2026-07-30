/**
 * Tests for withRetry / isTransientError behaviour in SwiftRemitClient.
 *
 * We test the helpers indirectly by stubbing the SorobanRpc.Server methods
 * that submitTransaction and simulateCall delegate to.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RateLimitError, parseRetryAfterMs, withRetry, isTransientError } from "./retry.js";

// ─── Inline the helpers under test so we don't need to export them ────────────

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Returns a mock that fails `failCount` times then resolves with `value`. */
function failThenSucceed<T>(failCount: number, error: Error, value: T) {
  let calls = 0;
  return vi.fn(async () => {
    if (calls++ < failCount) throw error;
    return value;
  });
}

// ─── isTransientError ─────────────────────────────────────────────────────────

describe("isTransientError", () => {
  it.each([
    ["429 Too Many Requests", true],
    ["503 Service Unavailable", true],
    ["ECONNRESET", true],
    ["ECONNREFUSED", true],
    ["ETIMEDOUT", true],
    ["network error", true],
    ["timeout exceeded", true],
    ["Simulation failed: auth error", false],
    ["Submit failed: invalid sequence", false],
    ["Transaction failed: bad signature", false],
  ])("classifies %s as transient=%s", (msg, expected) => {
    expect(isTransientError(new Error(msg))).toBe(expected);
  });

  it("classifies RateLimitError as transient (contains 429)", () => {
    const err = new RateLimitError(60, "429 Rate limit exceeded");
    expect(isTransientError(err)).toBe(true);
  });
});

// ─── parseRetryAfterMs ────────────────────────────────────────────────────────

describe("parseRetryAfterMs", () => {
  it("parses integer seconds", () => {
    expect(parseRetryAfterMs("120")).toBe(120_000);
  });

  it("parses zero seconds", () => {
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("returns null for null input", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseRetryAfterMs(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseRetryAfterMs("")).toBeNull();
  });

  it("parses HTTP-date format", () => {
    const futureDate = new Date(Date.now() + 30_000);
    const result = parseRetryAfterMs(futureDate.toUTCString());
    // Should be approximately 30 seconds, allow 1s tolerance
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(29_000);
    expect(result!).toBeLessThanOrEqual(31_000);
  });

  it("clamps negative HTTP-date to 0", () => {
    const pastDate = new Date(Date.now() - 10_000);
    const result = parseRetryAfterMs(pastDate.toUTCString());
    expect(result).toBe(0);
  });

  it("returns null for invalid string", () => {
    expect(parseRetryAfterMs("not-a-number-or-date")).toBeNull();
  });
});

// ─── RateLimitError ───────────────────────────────────────────────────────────

describe("RateLimitError", () => {
  it("stores retryAfterMs in milliseconds", () => {
    const err = new RateLimitError(120);
    expect(err.retryAfterMs).toBe(120_000);
  });

  it("stores optional resetAt timestamp", () => {
    const resetAt = "2026-07-30T12:30:00.000Z";
    const err = new RateLimitError(60, "Rate limited", resetAt);
    expect(err.resetAt).toBe(resetAt);
  });

  it("generates default message when none provided", () => {
    const err = new RateLimitError(90);
    expect(err.message).toContain("90");
  });

  it("uses provided message", () => {
    const err = new RateLimitError(60, "Custom rate limit message");
    expect(err.message).toBe("Custom rate limit message");
  });

  it("has correct error name", () => {
    const err = new RateLimitError(60);
    expect(err.name).toBe("RateLimitError");
  });
});

// ─── withRetry ────────────────────────────────────────────────────────────────

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns immediately on first success", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await withRetry(fn, 3, 0, 2);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error and succeeds", async () => {
    const fn = failThenSucceed(2, new Error("503 unavailable"), "done");
    const promise = withRetry(fn, 3, 0, 2);
    await vi.runAllTimersAsync();
    expect(await promise).toBe("done");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting all retries", async () => {
    const err = new Error("ECONNRESET");
    const fn = vi.fn(async () => { throw err; });
    const promise = withRetry(fn, 3, 0, 2);
    // suppress unhandled-rejection warning while timers run
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("ECONNRESET");
    // 1 initial attempt + 3 retries = 4 total calls
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("propagates non-transient errors immediately without retrying", async () => {
    const err = new Error("auth error");
    const fn = vi.fn(async () => { throw err; });
    // non-transient: no setTimeout involved, resolves synchronously in microtask
    await expect(withRetry(fn, 3, 0, 2)).rejects.toThrow("auth error");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("applies exponentially growing jittered backoff delays", async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((fn: TimerHandler, ms?: number) => {
        if (typeof ms === "number") delays.push(ms);
        return originalSetTimeout(fn as () => void, 0);
      });

    const fn = failThenSucceed(3, new Error("timeout"), "ok");
    const promise = withRetry(fn, 3, 100, 2);
    await vi.runAllTimersAsync();
    await promise;

    // Full jitter: each delay is drawn from [0, cap] where the cap grows
    // exponentially — 100, 200, 400 (100 * 2^0, 100 * 2^1, 100 * 2^2).
    expect(delays).toHaveLength(3);
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    expect(delays[0]).toBeLessThanOrEqual(100);
    expect(delays[1]).toBeGreaterThanOrEqual(0);
    expect(delays[1]).toBeLessThanOrEqual(200);
    expect(delays[2]).toBeGreaterThanOrEqual(0);
    expect(delays[2]).toBeLessThanOrEqual(400);

    setTimeoutSpy.mockRestore();
  });

  it("respects retries=0 (no retries)", async () => {
    const err = new Error("503");
    const fn = vi.fn(async () => { throw err; });
    const promise = withRetry(fn, 0, 0, 2);
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("honors RateLimitError.retryAfterMs instead of exponential backoff", async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((fn: TimerHandler, ms?: number) => {
        if (typeof ms === "number") delays.push(ms);
        return originalSetTimeout(fn as () => void, 0);
      });

    const rateLimitErr = new RateLimitError(30, "429 Rate limit exceeded"); // 30 seconds = 30_000ms
    const fn = failThenSucceed(1, rateLimitErr, "ok");

    const promise = withRetry(fn, 3, 100, 2); // default 100ms backoff
    await vi.runAllTimersAsync();
    await promise;

    // Should use 30_000ms (from Retry-After), NOT 100ms (exponential backoff)
    const retryDelays = delays.filter((d) => d > 0);
    expect(retryDelays).toContain(30_000);
    expect(retryDelays).not.toContain(100);

    setTimeoutSpy.mockRestore();
  });

  it("uses retryAfterMs exactly for RateLimitError (backs off by advertised duration)", async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((fn: TimerHandler, ms?: number) => {
        if (typeof ms === "number" && ms > 0) delays.push(ms);
        return originalSetTimeout(fn as () => void, 0);
      });

    // 45 seconds Retry-After
    const rateLimitErr = new RateLimitError(45, "429 Too Many Requests");
    let calls = 0;
    const fn = vi.fn(async () => {
      if (calls++ < 1) throw rateLimitErr;
      return "done";
    });

    const promise = withRetry(fn, 2, 1000, 2);
    await vi.runAllTimersAsync();
    expect(await promise).toBe("done");

    // Must wait exactly 45_000ms as advertised by Retry-After
    expect(delays).toEqual([45_000]);

    setTimeoutSpy.mockRestore();
  });
});
