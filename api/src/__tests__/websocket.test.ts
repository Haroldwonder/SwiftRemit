/**
 * WebSocket integration tests.
 *
 * Tests cover:
 *  - Successful connection and room join
 *  - status:updated event received after a status change
 *  - Unauthenticated connection is rejected
 *  - Unauthorized room join (user doesn't own remittance) is rejected
 *  - Client count drops correctly after disconnect
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, Server as HttpServer } from 'http';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { initWebSocket, closeWebSocket } from '../websocket';
import { emitStatusChange } from '../websocket/remittanceEvents';
import { createApp } from '../app';

// ── Helpers ────────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-secret-do-not-use-in-production';

function makeToken(
  userId: string,
  remittanceIds?: string[],
  secret = TEST_SECRET,
): string {
  return jwt.sign({ userId, remittanceIds }, secret, { expiresIn: '1h' });
}

function connectClient(
  port: number,
  token?: string,
): ClientSocket {
  return ioc(`http://localhost:${port}`, {
    auth: token ? { token } : undefined,
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
  });
}

function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 2000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for event "${event}"`)),
      timeoutMs,
    );
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function waitForConnect(socket: ClientSocket, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for connect')),
      timeoutMs,
    );
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForDisconnect(socket: ClientSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for disconnect')),
      timeoutMs,
    );
    socket.once('disconnect', (reason: string) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('WebSocket server', () => {
  let httpServer: HttpServer;
  let port: number;

  beforeAll(async () => {
    // Set the JWT secret the auth middleware reads
    process.env.JWT_SECRET = TEST_SECRET;

    const app = createApp();
    httpServer = createServer(app);
    initWebSocket(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve()); // port 0 = OS assigns a free port
    });

    const addr = httpServer.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    // closeWebSocket() closes the Socket.IO server but does NOT close the
    // underlying HTTP server — we close that separately.
    await closeWebSocket();
    await new Promise<void>((resolve) => {
      // If the server is already closed, resolve immediately.
      if (!httpServer.listening) return resolve();
      httpServer.close(() => resolve());
    });
    delete process.env.JWT_SECRET;
  });

  // ── 1. Successful connection ─────────────────────────────────────────────

  describe('connection', () => {
    it('connects successfully with a valid JWT', async () => {
      const token = makeToken('user-1', ['rem-1']);
      const client = connectClient(port, token);

      client.connect();
      await waitForConnect(client);

      expect(client.connected).toBe(true);
      client.disconnect();
    });

    it('rejects connection with no token', async () => {
      const client = connectClient(port); // no token
      client.connect();

      const err = await new Promise<Error>((resolve) => {
        client.once('connect_error', resolve);
      });

      expect(err.message).toMatch(/401/);
      expect(client.connected).toBe(false);
    });

    it('rejects connection with an invalid token', async () => {
      const client = connectClient(port, 'not.a.valid.jwt');
      client.connect();

      const err = await new Promise<Error>((resolve) => {
        client.once('connect_error', resolve);
      });

      expect(err.message).toMatch(/401/);
      expect(client.connected).toBe(false);
    });

    it('rejects connection with a token signed by the wrong secret', async () => {
      const token = makeToken('user-1', ['rem-1'], 'wrong-secret');
      const client = connectClient(port, token);
      client.connect();

      const err = await new Promise<Error>((resolve) => {
        client.once('connect_error', resolve);
      });

      expect(err.message).toMatch(/401/);
    });
  });

  // ── 2. Room join ─────────────────────────────────────────────────────────

  describe('remittance:join', () => {
    let client: ClientSocket;

    beforeEach(async () => {
      const token = makeToken('user-2', ['rem-42']);
      client = connectClient(port, token);
      client.connect();
      await waitForConnect(client);
    });

    afterEach(() => {
      if (client.connected) client.disconnect();
    });

    it('joins an authorised room and receives ack', async () => {
      const ack = await new Promise<{ success: boolean }>((resolve) => {
        client.emit('remittance:join', { remittanceId: 'rem-42' }, resolve);
      });

      expect(ack.success).toBe(true);
    });

    it('rejects join for a remittance the user does not own', async () => {
      const disconnectPromise = waitForDisconnect(client);

      client.emit('remittance:join', { remittanceId: 'rem-999' }, (ack: { success: boolean; error?: string }) => {
        expect(ack.success).toBe(false);
        expect(ack.error).toMatch(/403/);
      });

      // Server disconnects the socket after an unauthorized join attempt
      await disconnectPromise;
      expect(client.connected).toBe(false);
    });

    it('returns error ack when remittanceId is missing', async () => {
      const ack = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        client.emit('remittance:join', {}, resolve);
      });

      expect(ack.success).toBe(false);
      expect(ack.error).toBeTruthy();
    });
  });

  // ── 3. status:updated event ──────────────────────────────────────────────

  describe('status:updated', () => {
    it('delivers status:updated to a client in the room', async () => {
      const token = makeToken('user-3', ['rem-100']);
      const client = connectClient(port, token);
      client.connect();
      await waitForConnect(client);

      // Join the room
      await new Promise<void>((resolve) => {
        client.emit('remittance:join', { remittanceId: 'rem-100' }, () => resolve());
      });

      // Listen for the event before emitting so we don't miss it
      const eventPromise = waitForEvent<{
        remittanceId: string;
        status: string;
        updatedAt: string;
      }>(client, 'status:updated');

      // Trigger a status change (same tick)
      emitStatusChange('rem-100', 'Processing');

      const payload = await eventPromise;

      expect(payload.remittanceId).toBe('rem-100');
      expect(payload.status).toBe('Processing');
      expect(typeof payload.updatedAt).toBe('string');
      // updatedAt must be a valid ISO 8601 date
      expect(new Date(payload.updatedAt).toISOString()).toBe(payload.updatedAt);

      client.disconnect();
    });

    it('does NOT deliver status:updated to a client not in the room', async () => {
      const token = makeToken('user-4', ['rem-200', 'rem-201']);
      const client = connectClient(port, token);
      client.connect();
      await waitForConnect(client);

      // Join rem-200 only
      await new Promise<void>((resolve) => {
        client.emit('remittance:join', { remittanceId: 'rem-200' }, () => resolve());
      });

      let received = false;
      client.on('status:updated', () => {
        received = true;
      });

      // Emit for rem-201 — client should NOT receive this
      emitStatusChange('rem-201', 'Completed');

      // Wait a tick to confirm no event arrives
      await new Promise((r) => setTimeout(r, 100));

      expect(received).toBe(false);
      client.disconnect();
    });

    it('delivers status:updated within one event-loop tick', async () => {
      const token = makeToken('user-5', ['rem-300']);
      const client = connectClient(port, token);
      client.connect();
      await waitForConnect(client);

      await new Promise<void>((resolve) => {
        client.emit('remittance:join', { remittanceId: 'rem-300' }, () => resolve());
      });

      const eventPromise = waitForEvent(client, 'status:updated', 500);

      // Emit synchronously — the WebSocket broadcast happens in the same tick
      emitStatusChange('rem-300', 'Cancelled');

      // Should resolve well within 500 ms
      await expect(eventPromise).resolves.toBeDefined();

      client.disconnect();
    });
  });

  // ── 4. Client count after disconnect ────────────────────────────────────

  describe('client count', () => {
    it('decrements connected client count after disconnect', async () => {
      const io = (await import('../websocket')).getIo();

      const token = makeToken('user-6', ['rem-400']);
      const client = connectClient(port, token);
      client.connect();
      await waitForConnect(client);

      const beforeCount = (await io.fetchSockets()).length;

      const disconnectPromise = waitForDisconnect(client);
      client.disconnect();
      await disconnectPromise;

      // Give Socket.IO a tick to clean up
      await new Promise((r) => setTimeout(r, 50));

      const afterCount = (await io.fetchSockets()).length;
      expect(afterCount).toBe(beforeCount - 1);
    });
  });
});
