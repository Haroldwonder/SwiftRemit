/**
 * Test helpers for the JWT guards added in SR-047 / SR-048.
 *
 * Routes that return financial data now require a verified access token, so
 * tests that exercise them must present one. These helpers mint tokens through
 * the same claim set `routes/auth.ts` issues, so a token that works here is a
 * token the middleware genuinely accepts — no test-only bypass.
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  UserRole,
} from '../../middleware/auth.js';

export const TEST_JWT_SECRET = 'test-secret-for-auth-guards';

/** Ensures the signing secret is present before a token is minted or verified. */
export function useTestJwtSecret(): void {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
}

export interface TokenOptions {
  role?: UserRole;
  /** Seconds until expiry. Negative values produce an already-expired token. */
  expiresInSeconds?: number;
  issuer?: string;
  audience?: string;
  secret?: string;
  jti?: string;
}

/** Mints an access token with the same claims the login route issues. */
export function makeAccessToken(userId: string, options: TokenOptions = {}): string {
  const {
    role = 'user',
    expiresInSeconds = 900,
    issuer = JWT_ISSUER,
    audience = JWT_AUDIENCE,
    secret = process.env.JWT_SECRET ?? TEST_JWT_SECRET,
    jti = crypto.randomBytes(16).toString('hex'),
  } = options;

  return jwt.sign({ role }, secret, {
    algorithm: JWT_ALGORITHM,
    subject: userId,
    issuer,
    audience,
    expiresIn: expiresInSeconds,
    jwtid: jti,
  });
}

/** `Authorization` header value for a freshly minted token. */
export function bearer(userId: string, options: TokenOptions = {}): string {
  return `Bearer ${makeAccessToken(userId, options)}`;
}

/**
 * Builds an unsigned `alg: none` token.
 *
 * Verification must reject this outright — accepting it would let anyone mint
 * any identity. Constructed by hand because `jsonwebtoken` refuses to sign one.
 */
export function makeAlgNoneToken(userId: string, role: UserRole = 'admin'): string {
  const encode = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const header = encode({ alg: 'none', typ: 'JWT' });
  const payload = encode({
    sub: userId,
    role,
    jti: crypto.randomBytes(16).toString('hex'),
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 900,
  });

  // Trailing dot with an empty signature — the classic `alg: none` shape.
  return `${header}.${payload}.`;
}
