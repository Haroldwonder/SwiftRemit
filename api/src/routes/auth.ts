/**
 * JWT authentication endpoints (Issue #883, hardened for SR-047).
 *
 * POST /api/auth/login   - Issue short-lived access token + HttpOnly refresh token
 * POST /api/auth/refresh - Rotate refresh token and issue new access token
 * POST /api/auth/logout  - Revoke the refresh family AND the presented access token
 *
 * Access token TTL:  15 minutes
 * Refresh token TTL: 7 days (HttpOnly, Secure, SameSite=Strict cookie)
 *
 * What SR-047 changed:
 *  - Access tokens carry `jti`, `iss`, `aud`, and `role`, and are signed with a
 *    pinned algorithm so `alg: none` and HS/RS confusion are rejected on verify.
 *  - Refresh tokens belong to a family. Redeeming a spent token is treated as a
 *    leak and revokes the whole family rather than that one token.
 *  - Logout revokes the access token too. Previously it deleted the refresh
 *    token while the access token stayed valid for up to 15 minutes.
 *  - Login is throttled per identity with lockout.
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { ErrorResponse } from '../types';
import { sanitizeInput } from '../utils/sanitize.js';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  UserRole,
  extractBearerToken,
  verifyAccessToken,
} from '../middleware/auth.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  clearLoginFailures,
  isLockedOut,
  issueRefreshToken,
  recordLoginFailure,
  revokeAccessToken,
  revokeFamily,
  rotateRefreshToken,
} from '../services/tokenStore.js';

function timestamp(): string {
  return new Date().toISOString();
}

function sendError(res: Response, status: number, message: string, code: string): Response<ErrorResponse> {
  return res.status(status).json({ success: false, error: { message, code }, timestamp: timestamp() });
}

const REFRESH_COOKIE = 'swiftremit_refresh';

function issueAccessToken(userId: string, role: UserRole): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');

  return jwt.sign({ role }, secret, {
    algorithm: JWT_ALGORITHM,
    subject: userId,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    jwtid: crypto.randomBytes(16).toString('hex'),
  });
}

function setCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: REFRESH_TOKEN_TTL_MS,
    path: '/api/auth',
  };
}

/**
 * Resolves the role for a user id.
 *
 * Admin identities come from ADMIN_USER_IDS so admin status is never derived
 * from anything the client sends. Integrate with the real user store when one
 * exists.
 */
function resolveRole(userId: string): UserRole {
  const admins = (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (admins.includes(userId)) return 'admin';

  const agents = (process.env.AGENT_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (agents.includes(userId)) return 'agent';

  return 'user';
}

/**
 * Stubbed credential check.
 *
 * Previously this accepted ANY password when NODE_ENV=test, so the test suite
 * exercised an auth path that could never fail. It now requires a configured
 * password in every environment.
 */
function verifyCredentials(password: string): boolean {
  const expected = process.env.STUB_PASSWORD;
  if (!expected) return false;

  const given = Buffer.from(password);
  const want = Buffer.from(expected);
  if (given.length !== want.length) return false;

  return crypto.timingSafeEqual(given, want);
}

export function createAuthRouter(): Router {
  const router = Router();

  /**
   * POST /api/auth/login
   * Body: { userId: string, password: string }
   */
  router.post('/login', (req: Request, res: Response) => {
    const { userId, password } = req.body as Record<string, unknown>;

    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return sendError(res, 400, 'userId is required', 'MISSING_FIELD');
    }
    if (typeof password !== 'string' || password.length === 0) {
      return sendError(res, 400, 'password is required', 'MISSING_FIELD');
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return sendError(res, 503, 'Auth service not configured', 'SERVICE_UNAVAILABLE');
    }

    const sanitizedUserId = sanitizeInput(userId.trim());

    if (isLockedOut(sanitizedUserId)) {
      return sendError(
        res,
        429,
        'Too many failed login attempts. Try again later.',
        'ACCOUNT_LOCKED',
      );
    }

    if (!verifyCredentials(password)) {
      const lockedNow = recordLoginFailure(sanitizedUserId);
      if (lockedNow) {
        return sendError(
          res,
          429,
          'Too many failed login attempts. Try again later.',
          'ACCOUNT_LOCKED',
        );
      }
      // Same message either way — never reveal whether the identity exists.
      return sendError(res, 401, 'Invalid credentials', 'INVALID_CREDENTIALS');
    }

    clearLoginFailures(sanitizedUserId);

    const role = resolveRole(sanitizedUserId);
    const accessToken = issueAccessToken(sanitizedUserId, role);
    const { token: refreshToken } = issueRefreshToken(sanitizedUserId, role);

    res.cookie(REFRESH_COOKIE, refreshToken, setCookieOptions());

    return res.json({
      success: true,
      data: {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        role,
      },
      timestamp: timestamp(),
    });
  });

  /**
   * POST /api/auth/refresh
   *
   * Rotates the refresh token. Presenting an already-redeemed token means it
   * leaked, so the whole family is revoked and the caller must log in again.
   */
  router.post('/refresh', (req: Request, res: Response) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;

    if (!token) {
      return sendError(res, 401, 'Refresh token missing', 'MISSING_REFRESH_TOKEN');
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return sendError(res, 503, 'Auth service not configured', 'SERVICE_UNAVAILABLE');
    }

    const outcome = rotateRefreshToken(token);

    if (!outcome.ok) {
      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });

      if (outcome.reason === 'reused') {
        // The family is already revoked by the store; surface it for alerting.
        console.error(
          '[SECURITY] Refresh token reuse detected — token family revoked. Investigate for credential theft.',
        );
        return sendError(
          res,
          401,
          'Refresh token reuse detected. All sessions have been revoked.',
          'REFRESH_TOKEN_REUSED',
        );
      }
      if (outcome.reason === 'expired') {
        return sendError(res, 401, 'Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
      }
      return sendError(res, 401, 'Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    const { record, nextToken } = outcome;
    const newAccessToken = issueAccessToken(record.userId, record.role as UserRole);

    res.cookie(REFRESH_COOKIE, nextToken as string, setCookieOptions());

    return res.json({
      success: true,
      data: {
        access_token: newAccessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        role: record.role,
      },
      timestamp: timestamp(),
    });
  });

  /**
   * POST /api/auth/logout
   *
   * Revokes the refresh family and the presented access token. Revoking only
   * the refresh token would leave the access token usable until its own expiry.
   */
  router.post('/logout', (req: Request, res: Response) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (refreshToken) {
      // Redeem first so the family id is resolvable, then burn the family.
      const outcome = rotateRefreshToken(refreshToken);
      if (outcome.ok) {
        revokeFamily(outcome.record.familyId);
      }
    }

    const accessToken = extractBearerToken(req);
    if (accessToken) {
      const result = verifyAccessToken(accessToken);
      if (result.ok) {
        revokeAccessToken(result.auth.jti, result.auth.expiresAt);
      }
    }

    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return res.json({ success: true, timestamp: timestamp() });
  });

  return router;
}
