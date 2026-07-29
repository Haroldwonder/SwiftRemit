import { Socket, Server } from 'socket.io';
import { Keypair } from '@stellar/stellar-sdk';
import { createLogger } from './correlation-id';

const logger = createLogger('websocket-subscription');

/** TTL for a consumed nonce (matches the timestamp tolerance). */
const NONCE_TTL_MS = 300_000; // 5 minutes

/**
 * Single-use nonce store.
 *
 * Each entry is the unix-ms timestamp at which the nonce was recorded.
 * Entries are pruned when they exceed NONCE_TTL_MS to bound memory usage.
 *
 * Key format: `${address}:${timestamp}`
 */
const usedNonces = new Map<string, number>();

/** Periodic cleanup — remove nonces that have aged past their TTL. */
const _nonceCleanup = setInterval(() => {
  const cutoff = Date.now() - NONCE_TTL_MS;
  for (const [key, recordedAt] of usedNonces) {
    if (recordedAt < cutoff) usedNonces.delete(key);
  }
}, NONCE_TTL_MS);

// Allow the interval to be garbage-collected when the process exits
if (_nonceCleanup.unref) _nonceCleanup.unref();

/**
 * Reset the nonce store. Exposed for unit-test isolation only — do not
 * call this in production code.
 */
export function resetNonceStore(): void {
  usedNonces.clear();
}

/**
 * Enum for Socket.IO event names
 */
export enum SocketEvents {
  SUBSCRIBE_SENDER = 'subscribe_sender',
  UNSUBSCRIBE_SENDER = 'unsubscribe_sender',
  REMITTANCE_STATUS_UPDATE = 'remittance_status_update',
  SUBSCRIPTION_CONFIRMED = 'subscription_confirmed',
  SUBSCRIPTION_ERROR = 'subscription_error',
  RECONNECT_SUBSCRIBE = 'reconnect_subscribe',
}

/**
 * Room naming convention for sender subscriptions
 */
export function getSenderRoom(senderAddress: string): string {
  return `sender:${senderAddress}`;
}

/**
 * Validates a Stellar ed25519 signature proof for a sender-subscription request.
 *
 * Protocol
 * --------
 * The client signs the message  `${address}:${timestamp}`  with the Stellar
 * secret key that corresponds to `address`, then base64-encodes the raw
 * 64-byte signature and sends it as the `signature` field.
 *
 * Server-side checks (all must pass):
 *   1. `timestamp` is within `tolerance` ms of now (default 5 min).
 *   2. The nonce `${address}:${timestamp}` has not been used before
 *      (prevents replay within the tolerance window).
 *   3. `Keypair.fromPublicKey(address).verify(message, signatureBytes)` returns
 *      true — proves the caller controls the private key for `address`.
 *
 * @param address   Stellar public key (G…) that the client claims to own.
 * @param signature Base64-encoded ed25519 signature of `${address}:${timestamp}`.
 * @param timestamp Unix epoch in milliseconds, used as a single-use nonce.
 * @param tolerance Acceptable clock skew in milliseconds (default 300 000).
 * @returns `true` if and only if all checks pass.
 */
export function validateSignatureProof(
  address: string,
  signature: string,
  timestamp: number,
  tolerance: number = NONCE_TTL_MS
): boolean {
  // 1. Timestamp window — prevent use of stale or far-future proofs
  const now = Date.now();
  if (Math.abs(now - timestamp) > tolerance) {
    logger.warn('Signature proof timestamp out of tolerance', {
      address,
      diff: Math.abs(now - timestamp),
      tolerance,
    });
    return false;
  }

  // 2. Single-use nonce — prevent replay within the tolerance window
  const nonceKey = `${address}:${timestamp}`;
  if (usedNonces.has(nonceKey)) {
    logger.warn('Replayed nonce rejected', { address, timestamp });
    return false;
  }

  // 3. Cryptographic verification using Stellar ed25519
  try {
    const keypair = Keypair.fromPublicKey(address);
    const message = Buffer.from(`${address}:${timestamp}`);
    const signatureBytes = Buffer.from(signature, 'base64');

    if (!keypair.verify(message, signatureBytes)) {
      logger.warn('ed25519 signature verification failed', { address });
      return false;
    }
  } catch (err) {
    // Keypair.fromPublicKey throws for invalid Stellar addresses; treat as failure
    logger.warn('Signature verification error', { address, err });
    return false;
  }

  // Record nonce only after all checks pass to avoid poisoning on failed attempts
  usedNonces.set(nonceKey, now);
  return true;
}

/**
 * Register WebSocket handlers for sender-based subscriptions
 */
export function registerSenderSubscriptionHandlers(io: Server, socket: Socket): void {
  const userId = socket.data.user?.userId;

  if (!userId) {
    logger.warn('Socket connection without user ID');
    return;
  }

  /**
   * Handle subscription request with signature proof.
   *
   * Expected payload: { address: string, signature: string, timestamp: number }
   *
   * `signature` must be the base64-encoded ed25519 signature of the message
   * `${address}:${timestamp}` produced with the Stellar secret key for `address`.
   * `timestamp` is unix epoch in milliseconds and acts as a single-use nonce.
   *
   * Rejected subscriptions receive a SUBSCRIPTION_ERROR event with a 4xx-style
   * close code in the error object ({ code: 4001, error: '...' }).
   */
  socket.on(SocketEvents.SUBSCRIBE_SENDER, (payload: any) => {
    try {
      const { address, signature, timestamp } = payload;

      if (!address || typeof address !== 'string') {
        socket.emit(SocketEvents.SUBSCRIPTION_ERROR, {
          code: 4000,
          error: 'Invalid address',
        });
        return;
      }

      if (!validateSignatureProof(address, signature, timestamp)) {
        socket.emit(SocketEvents.SUBSCRIPTION_ERROR, {
          code: 4001,
          error: 'Invalid or expired signature proof',
        });
        return;
      }

      const room = getSenderRoom(address);
      socket.join(room);

      logger.info('Socket subscribed to sender room', {
        socketId: socket.id,
        room,
        userId,
      });

      socket.emit(SocketEvents.SUBSCRIPTION_CONFIRMED, {
        address,
        room,
        message: `Subscribed to remittance updates for ${address}`,
      });

      // Store subscription info on socket for reconnection
      if (!socket.data.subscriptions) {
        socket.data.subscriptions = [];
      }
      socket.data.subscriptions.push({ address, room });
    } catch (error) {
      logger.error('Error handling subscription', error);
      socket.emit(SocketEvents.SUBSCRIPTION_ERROR, {
        code: 4002,
        error: 'Failed to subscribe',
      });
    }
  });

  /**
   * Handle unsubscribe request
   */
  socket.on(SocketEvents.UNSUBSCRIBE_SENDER, (payload: any) => {
    try {
      const { address } = payload;

      if (!address || typeof address !== 'string') {
        return;
      }

      const room = getSenderRoom(address);
      socket.leave(room);

      logger.info('Socket unsubscribed from sender room', {
        socketId: socket.id,
        room,
      });

      // Remove from stored subscriptions
      if (socket.data.subscriptions) {
        socket.data.subscriptions = socket.data.subscriptions.filter(
          (s: any) => s.address !== address
        );
      }

      socket.emit(SocketEvents.SUBSCRIPTION_CONFIRMED, {
        address,
        message: `Unsubscribed from remittance updates for ${address}`,
      });
    } catch (error) {
      logger.error('Error handling unsubscription', error);
    }
  });

  /**
   * Handle reconnection - restore subscriptions
   */
  socket.on(SocketEvents.RECONNECT_SUBSCRIBE, () => {
    try {
      const subscriptions = socket.data.subscriptions || [];

      if (subscriptions.length === 0) {
        return;
      }

      subscriptions.forEach((sub: any) => {
        socket.join(sub.room);
      });

      logger.info('Socket subscriptions restored after reconnect', {
        socketId: socket.id,
        count: subscriptions.length,
      });

      socket.emit(SocketEvents.SUBSCRIPTION_CONFIRMED, {
        message: `Restored ${subscriptions.length} subscription(s)`,
        subscriptions,
      });
    } catch (error) {
      logger.error('Error handling reconnect subscriptions', error);
    }
  });

  /**
   * Handle disconnect - cleanup
   */
  socket.on('disconnect', () => {
    const subscriptions = socket.data.subscriptions || [];
    logger.info('Socket disconnected', {
      socketId: socket.id,
      subscriptionCount: subscriptions.length,
    });
  });
}

/**
 * Emit remittance status update to specific sender room
 */
export function emitToSenderRoom(
  io: Server,
  senderAddress: string,
  statusUpdate: {
    remittanceId: string;
    status: string;
    amount?: string;
    timestamp: Date;
    metadata?: Record<string, any>;
  }
): void {
  const room = getSenderRoom(senderAddress);

  io.to(room).emit(SocketEvents.REMITTANCE_STATUS_UPDATE, {
    ...statusUpdate,
    timestamp: statusUpdate.timestamp.toISOString(),
  });

  logger.info('Emitted status update to sender room', {
    room,
    remittanceId: statusUpdate.remittanceId,
    status: statusUpdate.status,
  });
}

/**
 * Get count of clients subscribed to a sender
 */
export function getSubscriberCount(io: Server, senderAddress: string): number {
  const room = getSenderRoom(senderAddress);
  const sockets = io.sockets.adapter.rooms.get(room);
  return sockets ? sockets.size : 0;
}
