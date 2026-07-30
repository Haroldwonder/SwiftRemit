import type { RetryPolicy } from "./types.js";
import { SwiftRemitError } from "./errors.js";

export function isTransientError(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  if (err instanceof SwiftRemitError) return err.retryable;

  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
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
 * Callers should use this to back off by exactly the advertised duration instead
 * of the jittered exponential backoff used for other transient failures.
 */
export class RateLimitError extends Error {
  /** How long to wait before retrying, in milliseconds (from Retry-After). */
  readonly retryAfterMs: number;
  /** ISO 8601 reset timestamp from the error body (if available). */
  readonly resetAt?: string;

  constructor(retryAfterSeconds: number, message?: string, resetAt?: string) {
    super(message ?? `Rate limit exceeded. Retry after ${retryAfterSeconds}s`);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterSeconds * 1000;
    this.resetAt = resetAt;
    // Maintain proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/**
 * Parse the Retry-After header value (seconds or HTTP-date) into milliseconds.
 * Returns null if the value cannot be parsed or is absent.
 */
export function parseRetryAfterMs(retryAfter: string | null | undefined): number | null {
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = new Date(retryAfter);
  if (!Number.isNaN(date.getTime())) {
    const delta = date.getTime() - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

/**
 * Extract Retry-After from an error object that may carry HTTP response metadata.
 * Supports: err.retryAfter, err.headers?.["retry-after"], err.response?.headers?.["retry-after"].
 */
export function extractRetryAfter(err: unknown): number | null {
  if (err == null || typeof err !== "object") return null;

  // A RateLimitError already carries the parsed Retry-After duration.
  if (err instanceof RateLimitError) return err.retryAfterMs;

  const e = err as Record<string, unknown>;

  // Direct property
  if (typeof e["retryAfter"] === "string" || typeof e["retryAfter"] === "number") {
    return parseRetryAfterMs(String(e["retryAfter"]));
  }

  // Headers bag directly on error
  if (e["headers"] && typeof e["headers"] === "object") {
    const h = e["headers"] as Record<string, string>;
    const val = h["retry-after"] ?? h["Retry-After"];
    if (val) return parseRetryAfterMs(val);
  }

  // headers inside err.response
  if (e["response"] && typeof e["response"] === "object") {
    const res = e["response"] as Record<string, unknown>;
    if (res["headers"] && typeof res["headers"] === "object") {
      const h = res["headers"] as Record<string, string>;
      const val = h["retry-after"] ?? h["Retry-After"];
      if (val) return parseRetryAfterMs(val);
    }
  }

  return null;
}

/**
 * Build a {@link RateLimitError} from a fetch Response that returned 429.
 * Reads the Retry-After header and, best-effort, the `error.resetAt` field
 * from the JSON body.
 */
export async function rateLimitErrorFromResponse(response: Response): Promise<RateLimitError> {
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after")) ?? 60_000;

  let resetAt: string | undefined;
  try {
    const body = (await response.json()) as { error?: { resetAt?: string } };
    resetAt = body?.error?.resetAt;
  } catch {
    // Body parsing is best-effort
  }

  return new RateLimitError(retryAfterMs / 1000, undefined, resetAt);
}

/**
 * Full jitter: pick a delay uniformly in [0, cap] to avoid thundering herds.
 * See https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
function jitteredDelay(baseMs: number, backoffFactor: number, attempt: number): number {
  const cap = baseMs * Math.pow(backoffFactor, attempt);
  return Math.random() * cap;
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

      // Honour Retry-After if present, otherwise use jittered exponential backoff
      const retryAfterMs = extractRetryAfter(err);
      const waitMs = retryAfterMs != null
        ? retryAfterMs
        : jitteredDelay(delayMs, backoffFactor, attempt);

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
