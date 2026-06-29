/**
 * WebSocket server setup.
 *
 * Attaches a Socket.IO server to the existing HTTP server instance so no
 * second port is opened. Exports the `io` singleton so any module can emit
 * events without importing socket.io directly.
 *
 * Usage (in src/index.ts):
 *
 *   import { createServer } from 'http';
 *   import { createApp } from './app';
 *   import { initWebSocket } from './websocket';
 *
 *   const httpServer = createServer(createApp());
 *   initWebSocket(httpServer);
 *   httpServer.listen(PORT);
 */

import { Server } from 'socket.io';
import { IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import { createAuthMiddleware } from './middleware/auth';
import { registerRemittanceHandlers, broadcastStatusUpdate } from './handlers/remittance';
import { onStatusChange } from './remittanceEvents';

/** The Socket.IO server instance — available after initWebSocket() is called */
let _io: Server | null = null;

/**
 * Returns the Socket.IO server instance.
 * Throws if called before initWebSocket().
 */
export function getIo(): Server {
  if (!_io) {
    throw new Error('WebSocket server has not been initialised. Call initWebSocket() first.');
  }
  return _io;
}

/**
 * Initialises the Socket.IO server and attaches it to the given HTTP server.
 *
 * Must be called once, before httpServer.listen().
 *
 * @param httpServer - The existing HTTP server created from the Express app.
 * @returns The Socket.IO Server instance.
 */
export function initWebSocket(
  httpServer: HttpServer<typeof IncomingMessage, typeof ServerResponse>,
): Server {
  if (_io) {
    return _io; // Idempotent — safe to call multiple times (e.g. in tests)
  }

  const io = new Server(httpServer, {
    cors: {
      // Mirror the Express CORS config. Tighten in production via CORS_ORIGIN env var.
      origin: process.env.CORS_ORIGIN ?? '*',
      methods: ['GET', 'POST'],
    },
    // Prefer WebSocket transport; fall back to long-polling for environments
    // that block WebSocket upgrades (e.g. some corporate proxies).
    transports: ['websocket', 'polling'],
  });

  // ── Authentication middleware ──────────────────────────────────────────────
  // Runs before the connection event. Unauthenticated sockets never reach
  // the connection handler.
  io.use(createAuthMiddleware());

  // ── Connection handler ─────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[ws] socket connected: ${socket.id} (user: ${socket.data.user?.userId})`);
    }

    registerRemittanceHandlers(io, socket);
  });

  // ── Subscribe to in-process status change events ───────────────────────────
  // The unsubscribe function is intentionally not stored — the subscription
  // lives for the lifetime of the process.
  onStatusChange((payload) => {
    broadcastStatusUpdate(io, payload);
  });

  _io = io;
  return io;
}

/**
 * Tears down the Socket.IO server.
 * Intended for use in tests only — do not call in production code.
 */
export async function closeWebSocket(): Promise<void> {
  if (_io) {
    await new Promise<void>((resolve, reject) => {
      _io!.close((err) => (err ? reject(err) : resolve()));
    });
    _io = null;
  }
}

// Re-export the event emitter helper so callers don't need two imports
export { emitStatusChange } from './remittanceEvents';
