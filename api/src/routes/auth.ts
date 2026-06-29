/**
 * JWT authentication endpoints (Issue #883).
 *
 * POST /api/auth/login   - Issue short-lived access token + HttpOnly refresh token
 * POST /api/auth/refresh - Rotate refresh token and issue new access token
 * POST /api/auth/logout  - Revoke refresh token (cookie cleared)
 *
 * Access token TTL:  15 minutes
 * Refresh token TTL: 7 days (stored in HttpOnly, Secure, SameSite=Strict cookie)
 *
 * Refresh tokens are single-use — each refresh rotates the token to prevent reuse.
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { ErrorResponse } from '../types';

function timestamp(): string {
  return new Date().toISOString();
}

function sendError(res: Response, status: number, message: string, code: string): Response<ErrorResponse> {
  return res.status(status).json({ success: false, error: { message, code }, timestamp: timestamp() });
}

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
const REFRESH_COOKIE = 'swiftremit_refresh';

/** In-memory refresh-token store: token → { userId, expiresAt } */
const refreshTokenStore = new Map<string, { userId: string; expiresAt: number }>();

function issueAccessToken(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return jwt.sign({ userId }, secret, { expiresIn: ACCESS_TOKEN_TTL });
}

function issueRefreshToken(userId: string): string {
  const token = crypto.randomBytes(40).toString('hex');
  refreshTokenStore.set(token, { userId, expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS });
  return token;
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

export function createAuthRouter(): Router {
  const router = Router();

  /**
   * POST /api/auth/login
   * Body: { userId: string, password: string }
   *
   * NOTE: Password verification is intentionally stubbed — integrate with
   * your user store / KYC service for production use.
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

    // Stub credential check — replace with real user lookup in production
    if (password !== process.env.STUB_PASSWORD && process.env.NODE_ENV !== 'test') {
      return sendError(res, 401, 'Invalid credentials', 'INVALID_CREDENTIALS');
    }

    const accessToken = issueAccessToken(userId.trim());
    const refreshToken = issueRefreshToken(userId.trim());

    res.cookie(REFRESH_COOKIE, refreshToken, setCookieOptions());

    return res.json({
      success: true,
      data: { access_token: accessToken, token_type: 'Bearer', expires_in: 900 },
      timestamp: timestamp(),
    });
  });

  /**
   * POST /api/auth/refresh
   * Reads refresh token from HttpOnly cookie.
   * Rotates the refresh token (single-use) and returns a new access token.
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

    const entry = refreshTokenStore.get(token);
    if (!entry) {
      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      return sendError(res, 401, 'Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    if (Date.now() > entry.expiresAt) {
      refreshTokenStore.delete(token);
      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      return sendError(res, 401, 'Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
    }

    // Rotate — invalidate old token, issue new pair
    refreshTokenStore.delete(token);
    const newAccessToken = issueAccessToken(entry.userId);
    const newRefreshToken = issueRefreshToken(entry.userId);

    res.cookie(REFRESH_COOKIE, newRefreshToken, setCookieOptions());

    return res.json({
      success: true,
      data: { access_token: newAccessToken, token_type: 'Bearer', expires_in: 900 },
      timestamp: timestamp(),
    });
  });

  /**
   * POST /api/auth/logout
   * Revokes the refresh token and clears the cookie.
   */
  router.post('/logout', (req: Request, res: Response) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (token) {
      refreshTokenStore.delete(token);
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return res.json({ success: true, timestamp: timestamp() });
  });

  return router;
}

/** Exported for test inspection / reset */
export { refreshTokenStore };
