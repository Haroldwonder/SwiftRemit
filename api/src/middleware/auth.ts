/**
 * HTTP JWT authentication middleware (SR-047, SR-048).
 *
 * Before this module the API issued access tokens in `routes/auth.ts` but never
 * verified one on any HTTP route — `jwt.verify` existed only in the Socket.IO
 * middleware. Every guard below is therefore new enforcement, not a refactor.
 *
 * Threat model addressed here:
 *
 *  - **`alg: none`** — an unsigned token is accepted by naive verification.
 *    Mitigated by pinning `algorithms: ['HS256']`; `jsonwebtoken` rejects any
 *    other `alg` in the header, including `none`.
 *  - **HS/RS confusion** — a token signed with the public key as an HMAC secret
 *    verifies if the algorithm is taken from the header. The same pin prevents it.
 *  - **Cross-service replay** — a token minted for another audience is rejected
 *    by the `issuer`/`audience` checks.
 *  - **Post-logout use** — access tokens are self-contained, so logout cannot
 *    delete them. Each carries a `jti` that logout adds to a revocation list.
 *  - **Privilege escalation** — `role` is checked explicitly; a user token can
 *    never satisfy an admin guard.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isAccessTokenRevoked } from '../services/tokenStore.js';
import { ErrorResponse } from '../types';

/** The single signing algorithm this API accepts. */
export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_ISSUER = 'swiftremit-api';
export const JWT_AUDIENCE = 'swiftremit-clients';

export type UserRole = 'user' | 'agent' | 'admin';

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  jti: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
}

/** The authenticated caller, attached to the request after a successful guard. */
export interface AuthContext {
  userId: string;
  role: UserRole;
  jti: string;
  /** The token's own expiry, needed to bound a revocation entry. */
  expiresAt: number;
}

// Augment the global Express namespace rather than the
// 'express-serve-static-core' module: express 5 resolves its own nested copy of
// those types, so a module augmentation would attach to the wrong declaration.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

function timestamp(): string {
  return new Date().toISOString();
}

function sendError(
  res: Response,
  status: number,
  message: string,
  code: string,
): Response<ErrorResponse> {
  return res.status(status).json({
    success: false,
    error: { message, code },
    timestamp: timestamp(),
  });
}

/** Pulls a bearer token out of the Authorization header. */
export function extractBearerToken(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) return null;

  const [scheme, ...rest] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;

  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

export type VerifyResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; status: number; message: string; code: string };

/**
 * Verifies an access token against the full threat model above.
 *
 * Exported separately from the middleware so non-Express callers (the GraphQL
 * executor, tests) can reuse exactly the same checks rather than reimplementing
 * a weaker subset.
 */
export function verifyAccessToken(token: string): VerifyResult {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return {
      ok: false,
      status: 503,
      message: 'Auth service not configured',
      code: 'SERVICE_UNAVAILABLE',
    };
  }

  let claims: AccessTokenClaims;
  try {
    // Pinning `algorithms` is what rejects `alg: none` and HS/RS confusion.
    claims = jwt.verify(token, secret, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as AccessTokenClaims;
  } catch (error) {
    const expired = error instanceof jwt.TokenExpiredError;
    return {
      ok: false,
      status: 401,
      message: expired ? 'Token expired' : 'Invalid token',
      code: expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
    };
  }

  if (!claims.jti || typeof claims.sub !== 'string' || !claims.sub) {
    return { ok: false, status: 401, message: 'Invalid token', code: 'INVALID_TOKEN' };
  }

  // Logout and family revocation both land here.
  if (isAccessTokenRevoked(claims.jti)) {
    return { ok: false, status: 401, message: 'Token revoked', code: 'TOKEN_REVOKED' };
  }

  const role: UserRole =
    claims.role === 'admin' || claims.role === 'agent' ? claims.role : 'user';

  return {
    ok: true,
    auth: { userId: claims.sub, role, jti: claims.jti, expiresAt: claims.exp ?? 0 },
  };
}

/**
 * Requires a valid access token. Attaches `req.auth` on success.
 *
 * Fails closed: any missing, malformed, expired, or revoked token is a 401 and
 * the handler never runs.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void | Response {
  const token = extractBearerToken(req);
  if (!token) {
    return sendError(res, 401, 'Authentication required', 'UNAUTHORIZED');
  }

  const result = verifyAccessToken(token);
  if (!result.ok) {
    return sendError(res, result.status, result.message, result.code);
  }

  req.auth = result.auth;
  next();
}

/**
 * Requires one of `roles` in addition to a valid token.
 *
 * `admin` deliberately does NOT satisfy an `agent`-only guard implicitly; list
 * every role a route accepts so the matrix stays readable and auditable.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void | Response => {
    const token = extractBearerToken(req);
    if (!token) {
      return sendError(res, 401, 'Authentication required', 'UNAUTHORIZED');
    }

    const result = verifyAccessToken(token);
    if (!result.ok) {
      return sendError(res, result.status, result.message, result.code);
    }

    if (!roles.includes(result.auth.role)) {
      // 403, not 401: the caller is authenticated but not permitted.
      return sendError(res, 403, 'Insufficient privileges', 'FORBIDDEN');
    }

    req.auth = result.auth;
    next();
  };
}

/** Admin-only guard. A user or agent token can never satisfy this. */
export const requireAdmin = requireRole('admin');

/** Agent or admin — used for agent registration and payout-address changes. */
export const requireAgentOrAdmin = requireRole('agent', 'admin');

/**
 * Ownership check for a resource keyed by an address or user id.
 *
 * Admins bypass; everyone else must match. Returns false and sends the response
 * when access is denied, so callers can `if (!ensureOwnership(...)) return;`.
 */
export function ensureOwnership(req: Request, res: Response, ownerId: string): boolean {
  const auth = req.auth;
  if (!auth) {
    sendError(res, 401, 'Authentication required', 'UNAUTHORIZED');
    return false;
  }

  if (auth.role === 'admin') return true;

  if (auth.userId !== ownerId) {
    // 404 would leak less, but the route contract here is an explicit 403.
    sendError(res, 403, 'You do not have access to this resource', 'FORBIDDEN');
    return false;
  }

  return true;
}
