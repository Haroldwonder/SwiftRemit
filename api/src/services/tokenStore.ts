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
 * Storage is in-memory, matching the existing convention in this codebase
 * (see `middleware/idempotency.ts`). A multi-instance deployment must back this
 * with Redis or the guarantees hold only per process — see AUTH_MATRIX.md.
 */

import crypto from 'crypto';

export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

/** Failed logins allowed before an identity is locked out. */
export const MAX_LOGIN_ATTEMPTS = 5;
/** How long an identity stays locked after exhausting its attempts. */
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
/** Failed attempts older than this no longer count toward the limit. */
export const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

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

const refreshTokens = new Map<string, RefreshRecord>();
const families = new Map<string, FamilyRecord>();
/** Revoked access-token `jti` → the moment the token would have expired anyway. */
const revokedAccessJtis = new Map<string, number>();
const loginAttempts = new Map<string, LoginAttemptRecord>();

/** Result of redeeming a refresh token. */
export type RefreshOutcome =
  | { ok: true; record: RefreshRecord }
  | { ok: false; reason: 'unknown' | 'expired' | 'reused' | 'family_revoked' };

function newId(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Starts a new refresh-token family and returns its first token. */
export function issueRefreshToken(userId: string, role: string): { token: string; familyId: string } {
  const familyId = newId();
  const token = newId();

  families.set(familyId, { userId, revoked: false, tokens: new Set([token]) });
  refreshTokens.set(token, {
    familyId,
    userId,
    role,
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
    used: false,
  });

  return { token, familyId };
}

/**
 * Redeems a refresh token and issues its replacement.
 *
 * Reuse detection is the point of this function: a token that has already been
 * redeemed can only be presented again if it was captured, so the whole family
 * is revoked and the caller is expected to alert.
 */
export function rotateRefreshToken(token: string): RefreshOutcome & { nextToken?: string } {
  const record = refreshTokens.get(token);
  if (!record) {
    return { ok: false, reason: 'unknown' };
  }

  const family = families.get(record.familyId);
  if (!family || family.revoked) {
    return { ok: false, reason: 'family_revoked' };
  }

  if (record.used) {
    // Replay of a spent token — assume compromise and burn the family.
    revokeFamily(record.familyId);
    return { ok: false, reason: 'reused' };
  }

  if (Date.now() > record.expiresAt) {
    return { ok: false, reason: 'expired' };
  }

  record.used = true;

  const nextToken = newId();
  family.tokens.add(nextToken);
  refreshTokens.set(nextToken, {
    familyId: record.familyId,
    userId: record.userId,
    role: record.role,
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
    used: false,
  });

  return { ok: true, record, nextToken };
}

/** Revokes every token in a family. Used on logout and on reuse detection. */
export function revokeFamily(familyId: string): void {
  const family = families.get(familyId);
  if (!family) return;

  family.revoked = true;
  for (const token of family.tokens) {
    refreshTokens.delete(token);
  }
}

export function getRefreshRecord(token: string): RefreshRecord | undefined {
  return refreshTokens.get(token);
}

/**
 * Marks an access token's `jti` revoked until `expiresAtSeconds` (the token's
 * own `exp`). Past that point the token fails signature-independent expiry
 * checks anyway, so the entry can be dropped.
 */
export function revokeAccessToken(jti: string, expiresAtSeconds: number): void {
  revokedAccessJtis.set(jti, expiresAtSeconds * 1000);
}

export function isAccessTokenRevoked(jti: string): boolean {
  const expiry = revokedAccessJtis.get(jti);
  if (expiry === undefined) return false;

  if (Date.now() > expiry) {
    revokedAccessJtis.delete(jti);
    return false;
  }
  return true;
}

/** True when the identity is currently locked out from logging in. */
export function isLockedOut(identity: string): boolean {
  const record = loginAttempts.get(identity);
  if (!record) return false;
  return Date.now() < record.lockedUntil;
}

/** Records a failed login. Returns true if this failure triggered a lockout. */
export function recordLoginFailure(identity: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(identity) ?? { failures: [], lockedUntil: 0 };

  record.failures = record.failures.filter((t) => now - t < LOGIN_ATTEMPT_WINDOW_MS);
  record.failures.push(now);

  let lockedNow = false;
  if (record.failures.length >= MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil = now + LOGIN_LOCKOUT_MS;
    record.failures = [];
    lockedNow = true;
  }

  loginAttempts.set(identity, record);
  return lockedNow;
}

export function clearLoginFailures(identity: string): void {
  loginAttempts.delete(identity);
}

/** Drops expired refresh tokens and revocation entries. */
export function pruneExpired(): void {
  const now = Date.now();

  for (const [token, record] of refreshTokens) {
    if (now > record.expiresAt) refreshTokens.delete(token);
  }
  for (const [jti, expiry] of revokedAccessJtis) {
    if (now > expiry) revokedAccessJtis.delete(jti);
  }
}

/** Test helper — clears all token state. */
export function resetTokenStore(): void {
  refreshTokens.clear();
  families.clear();
  revokedAccessJtis.clear();
  loginAttempts.clear();
}
