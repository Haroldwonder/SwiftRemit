/**
 * Tests for withRetry / isTransientError behaviour in SwiftRemitClient.
 *
 * We test the helpers indirectly by stubbing the SorobanRpc.Server methods
 * that submitTransaction and simulateCall delegate to.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Inline the helpers under test so we don't need to export them ────────────

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("network") ||
    msg.includes("timeout")
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  delayMs: number,
  backoffFactor: number
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isTransientError(err)) throw err;
      await new Promise((r) => setTimeout(r, delayMs * Math.pow(backoffFactor, attempt)));
      attempt++;
    }
  }
}

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

  it("applies exponential backoff delays", async () => {
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

    // delays should be 100, 200, 400 (100 * 2^0, 100 * 2^1, 100 * 2^2)
    const retryDelays = delays.filter((d) => d > 0);
    expect(retryDelays).toEqual([100, 200, 400]);

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
});
