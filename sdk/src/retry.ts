import type { RetryPolicy } from "./types.js";

export function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("timed out")
  );
}

export async function withRetry<T>(
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
      await new Promise((r) =>
        setTimeout(r, delayMs * Math.pow(backoffFactor, attempt))
      );
      attempt++;
    }
  }
}

/**
 * Apply a {@link RetryPolicy} object, filling in omitted fields from the provided
 * client defaults. Use this when you have a RetryPolicy that may be missing
 * delayMs or backoffFactor.
 */
export async function withRetryPolicy<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  defaults: { delayMs: number; backoffFactor: number }
): Promise<T> {
  return withRetry(
    fn,
    policy.retries,
    policy.delayMs ?? defaults.delayMs,
    policy.backoffFactor ?? defaults.backoffFactor
  );
}
