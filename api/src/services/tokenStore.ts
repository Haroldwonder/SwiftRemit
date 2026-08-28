/**
 * Token lifecycle store for JWT auth (SR-047).
 *
 * Holds the three pieces of state that make token auth safe and that a plain
 * `jwt.sign`/`jwt.verify` pair cannot provide on its own:
 *
 *  1. **Refresh-token families** — every login starts a family. Refreshing
 *     rotates the token within its family. Presenting a token that was already
 *     used means it leaked, so the entire family is revoked rather than just
 *     that token.
 *  2. **Access-token revocation** — access tokens are self-contained, so
 *     `logout` cannot invalidate one by deleting a row. Revoked `jti` values are
 *     held until their natural expiry and checked on every verification.
 *  3. **Login throttling** — failed attempts per identity, with lockout.
 *
 * Storage: an in-memory L1 cache per process (fast, synchronous reads — every
 * public function below keeps its original synchronous signature so callers
 * are unaffected) backed by Redis as the shared source of truth when
 * `REDIS_URL` is configured. Every mutation is written through to Redis with
 * the same TTL as its in-memory record and published on the
 * `sr:tokenstore:events` channel; every instance (including the one that made
 * the change) subscribes to that channel and applies the event to its local
 * Maps. This closes the multi-instance gap called out in AUTH_MATRIX.md:
 * logout on instance A now revokes the token on instances B/C within one
 * pub/sub round trip instead of only on the instance that saw the request.
 *
 * When `REDIS_URL` is not set (local dev, unit tests) the backend degrades to
 * a no-op and behaviour is identical to the original single-process store.
 */

import crypto from 'crypto';
import type { Redis as RedisClient } from 'ioredis';

export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

/** Failed logins allowed before an identity is locked out. */
export const MAX_LOGIN_ATTEMPTS = 5;
/** How long an identity stays locked after exhausting its attempts. */
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
/** Failed attempts older than this no longer count toward the limit. */
export const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

const EVENTS_CHANNEL = 'sr:tokenstore:events';
const KEY_PREFIX = 'sr:tokenstore:';

export interface RefreshRecord {
  familyId: string;
  userId: string;
  role: string;
  expiresAt: number;
  /** Set once the token has been redeemed. A second redemption means a leak. */
  used: boolean;
}

interface FamilyRecord {
  userId: string;
  revoked: boolean;
  /** Every token ever issued in this family, so revocation can sweep them all. */
  tokens: Set<string>;
}

interface LoginAttemptRecord {
  failures: number[];
  lockedUntil: number;
}

/** Result of redeeming a refresh token. */
export type RefreshOutcome =
  | { ok: true; record: RefreshRecord }
  | { ok: false; reason: 'unknown' | 'expired' | 'reused' | 'family_revoked' };

/**
 * Shared-storage backend contract. `NullBackend` is used when no Redis is
 * configured; `RedisBackend` wraps an `ioredis` client + a dedicated
 * subscriber connection (pub/sub requires its own connection in ioredis).
 * Tests use a third, in-process implementation to simulate two clients
 * sharing one backing store without a real Redis server — see
 * `tokenStore.multiInstance.test.ts`.
 */
export interface TokenStoreBackend {
  /** Persists `value` (already JSON-encoded) under `key` with a TTL. */
  set(key: string, value: string, ttlMs: number): void;
  del(key: string): void;
  /** Fan out an event to every subscriber, including the publisher. */
  publish(event: TokenStoreEvent): void;
  /** Registers a handler invoked for every published event (own and remote). */
  onEvent(handler: (event: TokenStoreEvent) => void): void;
}

export type TokenStoreEvent =
  | { type: 'refresh_issued'; token: string; record: RefreshRecord }
  | { type: 'refresh_used'; token: string }
  | { type: 'family_created'; familyId: string; userId: string; token: string }
  | { type: 'family_revoked'; familyId: string }
  | { type: 'access_revoked'; jti: string; expiresAtMs: number }
  | { type: 'login_failure'; identity: string; record: LoginAttemptRecord }
  | { type: 'login_cleared'; identity: string };

/** No-op backend — the original single-process behaviour. */
class NullBackend implements TokenStoreBackend {
  set(): void {
    /* no shared store configured */
  }
  del(): void {
    /* no shared store configured */
  }
  publish(): void {
    /* nothing to fan out to */
  }
  onEvent(): void {
    /* nothing to subscribe to */
  }
}

/**
 * Redis-backed implementation. Requires two connections: `client` for
 * reads/writes, `subscriber` for pub/sub (ioredis puts a connection in
 * subscriber mode once `subscribe()` is called, so it can no longer issue
 * normal commands).
 */
class RedisBackend implements TokenStoreBackend {
  private handlers: Array<(event: TokenStoreEvent) => void> = [];

  constructor(
    private readonly client: RedisClient,
    private readonly subscriber: RedisClient,
  ) {
    this.subscriber.subscribe(EVENTS_CHANNEL).catch((err) => {
      console.error('[tokenStore] failed to subscribe to Redis channel', err);
    });

    this.subscriber.on('message', (_channel: string, raw: string) => {
      try {
        const event = JSON.parse(raw) as TokenStoreEvent;
        for (const handler of this.handlers) handler(event);
      } catch (err) {
        console.error('[tokenStore] failed to parse Redis event', err);
      }
    });
  }

  set(key: string, value: string, ttlMs: number): void {
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    this.client.set(KEY_PREFIX + key, value, 'EX', ttlSeconds).catch((err) => {
      console.error(`[tokenStore] Redis SET failed for ${key}`, err);
    });
  }

  del(key: string): void {
    this.client.del(KEY_PREFIX + key).catch((err) => {
      console.error(`[tokenStore] Redis DEL failed for ${key}`, err);
    });
  }

  publish(event: TokenStoreEvent): void {
    this.client.publish(EVENTS_CHANNEL, JSON.stringify(event)).catch((err) => {
      console.error('[tokenStore] Redis PUBLISH failed', err);
    });
  }

  onEvent(handler: (event: TokenStoreEvent) => void): void {
    this.handlers.push(handler);
  }
}

/**
 * The store itself. Exposed as a class so tests can create multiple
 * instances that share one `TokenStoreBackend` and prove that revocation and
 * lockout propagate between them, instead of only ever exercising the single
 * module-level singleton below.
 */
export class TokenStore {
  private refreshTokens = new Map<string, RefreshRecord>();
  private families = new Map<string, FamilyRecord>();
  /** Revoked access-token `jti` → the moment the token would have expired anyway. */
  private revokedAccessJtis = new Map<string, number>();
  private loginAttempts = new Map<string, LoginAttemptRecord>();

  constructor(private readonly backend: TokenStoreBackend = new NullBackend()) {
    this.backend.onEvent((event) => this.applyEvent(event));
  }

  /** Applies an event from this or another instance to the local L1 cache. */
  private applyEvent(event: TokenStoreEvent): void {
    switch (event.type) {
      case 'refresh_issued':
        this.refreshTokens.set(event.token, event.record);
        break;
      case 'refresh_used': {
        const record = this.refreshTokens.get(event.token);
        if (record) record.used = true;
        break;
      }
      case 'family_created': {
        const family = this.families.get(event.familyId) ?? {
          userId: event.userId,
          revoked: false,
          tokens: new Set<string>(),
        };
        family.tokens.add(event.token);
        this.families.set(event.familyId, family);
        break;
      }
      case 'family_revoked': {
        const family = this.families.get(event.familyId);
        if (family) {
          family.revoked = true;
          for (const token of family.tokens) this.refreshTokens.delete(token);
        } else {
          // Revoked on another instance that hasn't shared a token list with
          // us yet — record the revocation so any future lookup still fails.
          this.families.set(event.familyId, { userId: '', revoked: true, tokens: new Set() });
        }
        break;
      }
      case 'access_revoked':
        this.revokedAccessJtis.set(event.jti, event.expiresAtMs);
        break;
      case 'login_failure':
        this.loginAttempts.set(event.identity, event.record);
        break;
      case 'login_cleared':
        this.loginAttempts.delete(event.identity);
        break;
    }
  }

  private newId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /** Starts a new refresh-token family and returns its first token. */
  issueRefreshToken(userId: string, role: string): { token: string; familyId: string } {
    const familyId = this.newId();
    const token = this.newId();
    const record: RefreshRecord = {
      familyId,
      userId,
      role,
      expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
      used: false,
    };

    this.families.set(familyId, { userId, revoked: false, tokens: new Set([token]) });
    this.refreshTokens.set(token, record);

    this.backend.set(`family:${familyId}`, JSON.stringify({ userId }), REFRESH_TOKEN_TTL_MS);
    this.backend.set(`refresh:${token}`, JSON.stringify(record), REFRESH_TOKEN_TTL_MS);
    this.backend.publish({ type: 'family_created', familyId, userId, token });
    this.backend.publish({ type: 'refresh_issued', token, record });

    return { token, familyId };
  }

  /**
   * Redeems a refresh token and issues its replacement.
   *
   * Reuse detection is the point of this function: a token that has already
   * been redeemed can only be presented again if it was captured, so the
   * whole family is revoked and the caller is expected to alert.
   */
  rotateRefreshToken(token: string): RefreshOutcome & { nextToken?: string } {
    const record = this.refreshTokens.get(token);
    if (!record) {
      return { ok: false, reason: 'unknown' };
    }

    const family = this.families.get(record.familyId);
    if (!family || family.revoked) {
      return { ok: false, reason: 'family_revoked' };
    }

    if (record.used) {
      // Replay of a spent token — assume compromise and burn the family.
      this.revokeFamily(record.familyId);
      return { ok: false, reason: 'reused' };
    }

    if (Date.now() > record.expiresAt) {
      return { ok: false, reason: 'expired' };
    }

    record.used = true;
    this.backend.publish({ type: 'refresh_used', token });

    const nextToken = this.newId();
    const nextRecord: RefreshRecord = {
      familyId: record.familyId,
      userId: record.userId,
      role: record.role,
      expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
      used: false,
    };
    family.tokens.add(nextToken);
    this.refreshTokens.set(nextToken, nextRecord);

    this.backend.set(`refresh:${nextToken}`, JSON.stringify(nextRecord), REFRESH_TOKEN_TTL_MS);
    this.backend.publish({ type: 'family_created', familyId: record.familyId, userId: record.userId, token: nextToken });
    this.backend.publish({ type: 'refresh_issued', token: nextToken, record: nextRecord });

    return { ok: true, record, nextToken };
  }

  /** Revokes every token in a family. Used on logout and on reuse detection. */
  revokeFamily(familyId: string): void {
    const family = this.families.get(familyId);
    if (!family) return;

    family.revoked = true;
    for (const token of family.tokens) {
      this.refreshTokens.delete(token);
      this.backend.del(`refresh:${token}`);
    }

    this.backend.publish({ type: 'family_revoked', familyId });
  }

  getRefreshRecord(token: string): RefreshRecord | undefined {
    return this.refreshTokens.get(token);
  }

  /**
   * Marks an access token's `jti` revoked until `expiresAtSeconds` (the
   * token's own `exp`). Past that point the token fails signature-independent
   * expiry checks anyway, so the entry can be dropped.
   */
  revokeAccessToken(jti: string, expiresAtSeconds: number): void {
    const expiresAtMs = expiresAtSeconds * 1000;
    this.revokedAccessJtis.set(jti, expiresAtMs);

    const ttlMs = Math.max(1000, expiresAtMs - Date.now());
    this.backend.set(`revoked:${jti}`, '1', ttlMs);
    this.backend.publish({ type: 'access_revoked', jti, expiresAtMs });
  }

  isAccessTokenRevoked(jti: string): boolean {
    const expiry = this.revokedAccessJtis.get(jti);
    if (expiry === undefined) return false;

    if (Date.now() > expiry) {
      this.revokedAccessJtis.delete(jti);
      return false;
    }
    return true;
  }

  /** True when the identity is currently locked out from logging in. */
  isLockedOut(identity: string): boolean {
    const record = this.loginAttempts.get(identity);
    if (!record) return false;
    return Date.now() < record.lockedUntil;
  }

  /** Records a failed login. Returns true if this failure triggered a lockout. */
  recordLoginFailure(identity: string): boolean {
    const now = Date.now();
    const record = this.loginAttempts.get(identity) ?? { failures: [], lockedUntil: 0 };

    record.failures = record.failures.filter((t) => now - t < LOGIN_ATTEMPT_WINDOW_MS);
    record.failures.push(now);

    let lockedNow = false;
    let ttlMs = LOGIN_ATTEMPT_WINDOW_MS;
    if (record.failures.length >= MAX_LOGIN_ATTEMPTS) {
      record.lockedUntil = now + LOGIN_LOCKOUT_MS;
      record.failures = [];
      lockedNow = true;
      ttlMs = LOGIN_LOCKOUT_MS;
    }

    this.loginAttempts.set(identity, record);
    this.backend.set(`lockout:${identity}`, JSON.stringify(record), ttlMs);
    this.backend.publish({ type: 'login_failure', identity, record });

    return lockedNow;
  }

  clearLoginFailures(identity: string): void {
    this.loginAttempts.delete(identity);
    this.backend.del(`lockout:${identity}`);
    this.backend.publish({ type: 'login_cleared', identity });
  }

  /** Drops expired refresh tokens and revocation entries from the local cache. */
  pruneExpired(): void {
    const now = Date.now();

    for (const [token, record] of this.refreshTokens) {
      if (now > record.expiresAt) this.refreshTokens.delete(token);
    }
    for (const [jti, expiry] of this.revokedAccessJtis) {
      if (now > expiry) this.revokedAccessJtis.delete(jti);
    }
  }

  /** Test helper — clears all local token state (does not touch Redis). */
  reset(): void {
    this.refreshTokens.clear();
    this.families.clear();
    this.revokedAccessJtis.clear();
    this.loginAttempts.clear();
  }
}

/**
 * Builds the shared backend from `REDIS_URL`. `ioredis` is imported
 * dynamically so environments that never set `REDIS_URL` (local dev, unit
 * tests) don't need the dependency installed at all.
 */
async function createBackend(): Promise<TokenStoreBackend> {
  const url = process.env.REDIS_URL;
  if (!url) return new NullBackend();

  try {
    const { default: IORedis } = await import('ioredis');
    const client: RedisClient = new IORedis(url);
    const subscriber: RedisClient = new IORedis(url);
    client.on('error', (err: Error) => console.error('[tokenStore] Redis client error', err));
    subscriber.on('error', (err: Error) => console.error('[tokenStore] Redis subscriber error', err));
    return new RedisBackend(client, subscriber);
  } catch (err) {
    console.error('[tokenStore] REDIS_URL is set but ioredis failed to initialise; falling back to per-process store', err);
    return new NullBackend();
  }
}

// Top-level await — safe here because this module is ESM (see package.json
// "type": "module") and every caller already imports it asynchronously.
const defaultStore = new TokenStore(await createBackend());

// ─── Module-level functions — unchanged signatures, delegate to the default
// singleton instance so every existing caller (routes/auth.ts,
// middleware/auth.ts, websocket/middleware/auth.ts) is unaffected. ──────────

export function issueRefreshToken(userId: string, role: string): { token: string; familyId: string } {
  return defaultStore.issueRefreshToken(userId, role);
}

export function rotateRefreshToken(token: string): RefreshOutcome & { nextToken?: string } {
  return defaultStore.rotateRefreshToken(token);
}

export function revokeFamily(familyId: string): void {
  return defaultStore.revokeFamily(familyId);
}

export function getRefreshRecord(token: string): RefreshRecord | undefined {
  return defaultStore.getRefreshRecord(token);
}

export function revokeAccessToken(jti: string, expiresAtSeconds: number): void {
  return defaultStore.revokeAccessToken(jti, expiresAtSeconds);
}

export function isAccessTokenRevoked(jti: string): boolean {
  return defaultStore.isAccessTokenRevoked(jti);
}

export function isLockedOut(identity: string): boolean {
  return defaultStore.isLockedOut(identity);
}

export function recordLoginFailure(identity: string): boolean {
  return defaultStore.recordLoginFailure(identity);
}

export function clearLoginFailures(identity: string): void {
  return defaultStore.clearLoginFailures(identity);
}

export function pruneExpired(): void {
  return defaultStore.pruneExpired();
}

/** Test helper — clears all token state. */
export function resetTokenStore(): void {
  defaultStore.reset();
}
