/**
 * JWT authentication middleware for Socket.IO connections.
 *
 * Validates the Bearer token supplied in the handshake auth object or
 * query string, then attaches the decoded user to the socket's `data`
 * property so downstream handlers can read it without re-verifying.
 *
 * Unauthenticated connections are disconnected immediately with a 401
 * error before they can join any room.
 */

import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
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
    return authToken.replace(/^Bearer\s+/i, '');
  }

  const queryToken = socket.handshake.query?.token;
  if (typeof queryToken === 'string' && queryToken.length > 0) {
    return queryToken.replace(/^Bearer\s+/i, '');
  }

  return null;
}

/**
 * Socket.IO middleware that enforces JWT authentication.
 *
 * Usage:
 *   io.use(createAuthMiddleware());
 */
export function createAuthMiddleware() {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    // Warn loudly at startup — missing secret means all connections will fail.
    console.warn(
      '[ws:auth] WARNING: JWT_SECRET is not set. All WebSocket connections will be rejected.',
    );
  }

  return (socket: Socket, next: (err?: Error) => void): void => {
    const token = extractToken(socket);

    if (!token) {
      return next(new Error('401: Authentication token required'));
    }

    if (!secret) {
      return next(new Error('401: Server misconfiguration — JWT_SECRET not set'));
    }

    try {
      const decoded = jwt.verify(token, secret) as AuthenticatedUser & jwt.JwtPayload;

      socket.data.user = {
        userId: decoded.userId ?? decoded.sub ?? '',
        remittanceIds: decoded.remittanceIds,
      };

      next();
    } catch (err) {
      next(new Error('401: Invalid or expired token'));
    }
  };
}
