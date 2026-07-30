/**
 * Idempotency-key middleware (Issue #878, hardened for SR-049).
 *
 * Correct idempotency needs three properties that are easy to miss, and the
 * previous implementation had none of them:
 *
 *  1. **Body binding.** The same key with a different body must conflict.
 *     Previously the cached response was replayed for ANY body, so a client
 *     reusing a key with a new amount silently received the old result and the
 *     new transfer never happened.
 *  2. **Concurrency.** Two simultaneous requests with one key must execute the
 *     operation once. Previously both missed the cache and both executed —
 *     precisely the double-spend an idempotency key exists to prevent.
 *  3. **Verbatim replay.** The replay must reproduce the original status,
 *     headers, and body. Previously the status was replayed but the stored
 *     headers were never reapplied.
 *
 * Storage is in-memory, matching the convention elsewhere in this codebase.
 * Behind more than one instance the guarantees hold only per process; a shared
 * store (Redis) is required before horizontal scaling. See AUTH_MATRIX.md.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/** How long a completed record is replayable. Documented in API.md. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** How long to wait for an in-flight request with the same key before giving up. */
const INFLIGHT_TIMEOUT_MS = 30_000;

/**
 * Paths where a key is mandatory. These move money, so a retry without a key
 * risks a duplicate transfer.
 */
const MONEY_MOVING_PATH = /^\/api\/(remittances|settlements|agents)(\/|$)/;

interface CompletedRecord {
  state: 'completed';
  bodyHash: string;
  status: number;
  headers: Record<string, string>;
  /** Serialized exactly as sent, so the replay is byte-identical. */
  payload: string;
  createdAt: number;
}

interface InFlightRecord {
  state: 'in-flight';
  bodyHash: string;
  createdAt: number;
  /** Resolves when the original request finishes. */
  done: Promise<void>;
  resolve: () => void;
}

type Record_ = CompletedRecord | InFlightRecord;

const store = new Map<string, Record_>();

function timestamp(): string {
  return new Date().toISOString();
}

/** Stable hash of the request body — key order must not change the result. */
export function hashRequestBody(body: unknown): string {
  return crypto.createHash('sha256').update(canonicalize(body)).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(',')}}`;
}

/** Validate idempotency key format (UUID v4 specifically). */
export function validateIdempotencyKey(key: string): boolean {
  const uuidv4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidv4Pattern.test(key);
}

function sendError(res: Response, status: number, message: string, code: string) {
  return res.status(status).json({
    success: false,
    error: { message, code },
    timestamp: timestamp(),
  });
}

function replay(res: Response, record: CompletedRecord, key: string): void {
  for (const [name, value] of Object.entries(record.headers)) {
    res.set(name, value);
  }
  res.set('Idempotency-Key', key);
  res.set('Idempotent-Replay', 'true');
  res.status(record.status).send(record.payload);
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, record] of store) {
    const age = now - record.createdAt;
    if (record.state === 'completed' && age > IDEMPOTENCY_TTL_MS) store.delete(key);
    // An in-flight record whose request died would otherwise wedge the key.
    if (record.state === 'in-flight' && age > INFLIGHT_TIMEOUT_MS) store.delete(key);
  }
}

export interface IdempotencyOptions {
  /** Paths where a key is mandatory. Defaults to the money-moving routes. */
  requiredPathPattern?: RegExp | null;
}

export function createIdempotencyMiddleware(options: IdempotencyOptions = {}) {
  const requiredPathPattern =
    options.requiredPathPattern === undefined ? MONEY_MOVING_PATH : options.requiredPathPattern;

  return async function idempotency(req: Request, res: Response, next: NextFunction) {
    if (req.method !== 'POST') return next();

    pruneExpired();

    const key = req.get('Idempotency-Key');
    const keyRequired = requiredPathPattern !== null && requiredPathPattern.test(req.path);

    if (!key) {
      if (keyRequired) {
        return sendError(
          res,
          400,
          'Idempotency-Key header is required for this endpoint',
          'IDEMPOTENCY_KEY_REQUIRED',
        );
      }
      return next();
    }

    if (!validateIdempotencyKey(key)) {
      return sendError(
        res,
        400,
        'Idempotency-Key must be a UUID v4',
        'INVALID_IDEMPOTENCY_KEY',
      );
    }

    const cacheKey = `${req.path}:${key}`;
    const bodyHash = hashRequestBody(req.body);
    const existing = store.get(cacheKey);

    if (existing) {
      // Same key, different body — the client changed the operation mid-retry.
      if (existing.bodyHash !== bodyHash) {
        return sendError(
          res,
          409,
          'Idempotency-Key was already used with a different request body',
          'IdempotencyConflict',
        );
      }

      if (existing.state === 'completed') {
        return replay(res, existing, key);
      }

      // A concurrent duplicate. Wait for the original rather than executing a
      // second time, then replay its result so both callers see one operation.
      await Promise.race([
        existing.done,
        new Promise((resolve) => setTimeout(resolve, INFLIGHT_TIMEOUT_MS)),
      ]);

      const settled = store.get(cacheKey);
      if (settled && settled.state === 'completed') {
        return replay(res, settled, key);
      }
      return sendError(
        res,
        409,
        'A request with this Idempotency-Key is still in progress',
        'IdempotencyConflict',
      );
    }

    // Claim the key before the handler runs. This insert is what makes a
    // concurrent duplicate observe an in-flight record instead of a miss.
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    store.set(cacheKey, {
      state: 'in-flight',
      bodyHash,
      createdAt: Date.now(),
      done,
      resolve: resolveDone,
    });

    res.set('Idempotency-Key', key);
    res.set('Cache-Control', 'private, no-store');

    const finish = (payload: string) => {
      store.set(cacheKey, {
        state: 'completed',
        bodyHash,
        status: res.statusCode,
        headers: {
          'Content-Type': res.get('Content-Type') ?? 'application/json; charset=utf-8',
          'Cache-Control': 'private, no-store',
        },
        payload,
        createdAt: Date.now(),
      });
      resolveDone();
    };

    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      finish(JSON.stringify(body));
      return originalJson(body);
    };

    // If the handler throws or the connection drops, release the claim so the
    // key is retryable rather than wedged until the in-flight timeout.
    res.on('close', () => {
      const current = store.get(cacheKey);
      if (current && current.state === 'in-flight') {
        store.delete(cacheKey);
        current.resolve();
      }
    });

    next();
  };
}

/** Default middleware — a key is mandatory on money-moving POSTs. */
export const idempotencyMiddleware = createIdempotencyMiddleware();

/** Clear idempotency cache for testing. */
export function clearIdempotencyCache(): void {
  store.clear();
}

/** Get cache stats for monitoring. */
export function getIdempotencyCacheStats() {
  let completed = 0;
  let inFlight = 0;
  for (const record of store.values()) {
    if (record.state === 'completed') completed += 1;
    else inFlight += 1;
  }
  return { keys: store.size, completed, inFlight };
}
