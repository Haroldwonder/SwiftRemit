import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createAuthMiddleware, reverifyOrDisconnect } from './auth';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../../middleware/auth';
import { revokeAccessToken, resetTokenStore } from '../../services/tokenStore';

const SECRET = 'test-secret-for-ws-auth-spec';

function signAccessToken(overrides: Partial<jwt.SignOptions> & { sub?: string; role?: string } = {}) {
  const { sub = 'user-1', role = 'user', ...signOpts } = overrides;
  return jwt.sign({ role }, SECRET, {
    algorithm: JWT_ALGORITHM,
    subject: sub,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: 900,
    jwtid: crypto.randomBytes(8).toString('hex'),
    ...signOpts,
  });
}

function decodeJti(token: string): string {
  const decoded = jwt.decode(token) as jwt.JwtPayload;
  return decoded.jti as string;
}

function decodeExp(token: string): number {
  const decoded = jwt.decode(token) as jwt.JwtPayload;
  return decoded.exp as number;
}

function makeSocket(token: string) {
  return {
    handshake: { auth: { token }, query: {} },
    data: {} as Record<string, unknown>,
    emit: vi.fn(),
    disconnect: vi.fn(),
  } as any;
}

describe('WebSocket auth middleware', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    resetTokenStore();
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
    resetTokenStore();
  });

  it('accepts a freshly issued token on a new connection', () => {
    const token = signAccessToken();
    const socket = makeSocket(token);
    const middleware = createAuthMiddleware();

    const next = vi.fn();
    middleware(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.user.userId).toBe('user-1');
  });

  it('rejects a connection whose access token was already revoked via logout', () => {
    const token = signAccessToken();
    revokeAccessToken(decodeJti(token), decodeExp(token));

    const socket = makeSocket(token);
    const middleware = createAuthMiddleware();

    const next = vi.fn();
    middleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    const err = next.mock.calls[0][0] as Error;
    expect(err.message).toMatch(/401/);
  });

  it('rejects a token signed with alg: none', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user-1', role: 'user', iss: JWT_ISSUER, aud: JWT_AUDIENCE, jti: 'x' }),
    ).toString('base64url');
    const forged = `${header}.${payload}.`;

    const socket = makeSocket(forged);
    const middleware = createAuthMiddleware();

    const next = vi.fn();
    middleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('disconnects an already-open socket once its token is revoked mid-session', () => {
    const token = signAccessToken();
    const socket = makeSocket(token);
    const middleware = createAuthMiddleware();

    const next = vi.fn();
    middleware(socket, next);
    expect(next).toHaveBeenCalledWith();

    // Logout happens after the socket is already connected.
    revokeAccessToken(decodeJti(token), decodeExp(token));

    const stillValid = reverifyOrDisconnect(socket);

    expect(stillValid).toBe(false);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
