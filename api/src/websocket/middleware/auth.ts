/**
 * JWT authentication middleware for Socket.IO connections.
 *
 * Validates the Bearer token supplied in the handshake auth object or
 * query string, then attaches the decoded user to the socket's `data`
 * property so downstream handlers can read it without re-verifying.
 *
 * Unauthenticated connections are disconnected immediately with a 401
 * error before they can join any room.
 *
 * This middleware delegates to the shared `verifyAccessToken()` from
 * `middleware/auth.ts` rather than calling `jwt.verify` directly, so the
 * same algorithm pinning (`alg: none` / HS-RS confusion protection),
 * issuer/audience checks, and access-token revocation check
 * (`isAccessTokenRevoked`) apply uniformly to both HTTP and WebSocket
 * connections. See that module's header comment for the full threat model.
 */

import { Socket } from 'socket.io';
import { verifyAccessToken } from '../../middleware/auth.js';
import { AuthenticatedUser } from '../types';

/** Extend Socket.data with our typed user field */
declare module 'socket.io' {
  interface SocketData {
    user: AuthenticatedUser;
  }
}

/**
 * Extracts the raw JWT string from the socket handshake.
 * Accepts:
 *   - socket.handshake.auth.token  (preferred — not logged by proxies)
 *   - socket.handshake.query.token (fallback for environments that can't
 *     set auth headers, e.g. browser EventSource polyfills)
 */
function extractToken(socket: Socket): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.length > 0) {
    if (authToken.toLowerCase().startsWith('bearer ')) {
      return authToken.slice(7);
    }
    return authToken;
  }

  const queryToken = socket.handshake.query?.token;
  if (typeof queryToken === 'string' && queryToken.length > 0) {
    if (queryToken.toLowerCase().startsWith('bearer ')) {
      return queryToken.slice(7);
    }
    return queryToken;
  }

  return null;
}

/**
 * Re-verifies the socket's current token against the shared auth checks,
 * including revocation. Used both on initial handshake and, optionally, on
 * already-open connections so a logout takes effect on live sockets too.
 */
function verifySocketToken(socket: Socket): { ok: true; user: AuthenticatedUser } | { ok: false; error: string } {
  const token = extractToken(socket);
  if (!token) {
    return { ok: false, error: '401: Authentication token required' };
  }

  const result = verifyAccessToken(token);
  if (!result.ok) {
    return { ok: false, error: `401: ${result.message}` };
  }

  return {
    ok: true,
    user: {
      userId: result.auth.userId,
      remittanceIds: (socket.data.user as AuthenticatedUser | undefined)?.remittanceIds,
      agentRemittanceIds: (socket.data.user as AuthenticatedUser | undefined)?.agentRemittanceIds,
      role: result.auth.role,
    },
  };
}

/**
 * Socket.IO middleware that enforces JWT authentication.
 *
 * Usage:
 *   io.use(createAuthMiddleware());
 */
export function createAuthMiddleware() {
  if (!process.env.JWT_SECRET) {
    // Warn loudly at startup — missing secret means all connections will fail.
    console.warn(
      '[ws:auth] WARNING: JWT_SECRET is not set. All WebSocket connections will be rejected.',
    );
  }

  return (socket: Socket, next: (err?: Error) => void): void => {
    const result = verifySocketToken(socket);

    if (!result.ok) {
      return next(new Error(result.error));
    }

    socket.data.user = result.user;
    next();
  };
}

/**
 * Re-checks an already-authenticated socket's token against the current
 * revocation state and disconnects it if the token has since been revoked
 * (e.g. via POST /api/auth/logout) or has expired.
 *
 * Socket.IO middleware only runs once, at connect time, so a token revoked
 * mid-connection would otherwise stay live until the socket naturally
 * disconnects. Call this periodically (e.g. from a `setInterval` alongside
 * connection bookkeeping) to close that gap for long-lived sockets.
 */
export function reverifyOrDisconnect(socket: Socket): boolean {
  const result = verifySocketToken(socket);
  if (!result.ok) {
    socket.emit('auth_error', { message: result.error });
    socket.disconnect(true);
    return false;
  }

  socket.data.user = result.user;
  return true;
}
