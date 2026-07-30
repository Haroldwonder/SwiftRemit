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

/**
 * A 429 response error that carries the Retry-After value from the response header.
 * Callers should use this to back off by exactly the advertised duration.
 */
export class RateLimitError extends Error {
  /** Number of seconds to wait before retrying, as specified in the Retry-After header. */
  readonly retryAfterMs: number;
  /** ISO 8601 reset timestamp from the error body (if available). */
  readonly resetAt?: string;

  constructor(retryAfterSeconds: number, message?: string, resetAt?: string) {
    super(message ?? `Rate limit exceeded. Retry after ${retryAfterSeconds}s`);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterSeconds * 1000;
    this.resetAt = resetAt;
  }
}

/**
 * Parse a Retry-After header value and return the delay in milliseconds.
 * Supports both integer-seconds ("120") and HTTP-date formats.
 * Returns null if the header is absent or unparseable.
 */
export function parseRetryAfterMs(retryAfterHeader: string | null | undefined): number | null {
  if (!retryAfterHeader) return null;

  const trimmed = retryAfterHeader.trim();

  // Integer seconds
  const seconds = parseInt(trimmed, 10);
  if (!isNaN(seconds) && seconds.toString() === trimmed) {
    return Math.max(0, seconds * 1000);
  }

  // HTTP-date format
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return null;
}

/**
 * Build a RateLimitError from a fetch Response object that returned 429.
 * Reads the Retry-After header and optionally the response body for resetAt.
 */
export async function rateLimitErrorFromResponse(response: Response): Promise<RateLimitError> {
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader) ?? 60_000; // default 60 s

  let resetAt: string | undefined;
  try {
    const body = await response.json();
    resetAt = body?.error?.resetAt as string | undefined;
  } catch {
    // Body parsing is best-effort
  }

  return new RateLimitError(retryAfterMs / 1000, undefined, resetAt);
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

      // Honor Retry-After from a RateLimitError — wait exactly the advertised duration
      let waitMs: number;
      if (err instanceof RateLimitError) {
        waitMs = err.retryAfterMs;
      } else {
        waitMs = delayMs * Math.pow(backoffFactor, attempt);
      }

      await new Promise((r) => setTimeout(r, waitMs));
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
