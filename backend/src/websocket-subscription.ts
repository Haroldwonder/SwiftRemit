import { Socket, Server } from 'socket.io';
import { createLogger } from './correlation-id';

const logger = createLogger('websocket-subscription');

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
 * Validates signature proof for sender subscription
 * In production, verify cryptographic signature of address + timestamp
 */
export function validateSignatureProof(
  address: string,
  signature: string,
  timestamp: number,
  tolerance: number = 300000 // 5 minutes in ms
): boolean {
  // Basic validation: timestamp should be recent
  const now = Date.now();
  if (Math.abs(now - timestamp) > tolerance) {
    logger.warn('Signature proof timestamp out of tolerance', { address, diff: Math.abs(now - timestamp), tolerance });
    return false;
  }

  // TODO: Verify cryptographic signature in production
  // For now, just validate format
  if (!signature || signature.length < 10) {
    logger.warn('Invalid signature format', { address });
    return false;
  }

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
   * Handle subscription request with signature proof
   * Event: subscribe_sender
   * Payload: { address, signature, timestamp }
   */
  socket.on(SocketEvents.SUBSCRIBE_SENDER, (payload: any) => {
    try {
      const { address, signature, timestamp } = payload;

      if (!address || typeof address !== 'string') {
        socket.emit(SocketEvents.SUBSCRIPTION_ERROR, {
          error: 'Invalid address',
        });
        return;
      }

      if (!validateSignatureProof(address, signature, timestamp)) {
        socket.emit(SocketEvents.SUBSCRIPTION_ERROR, {
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
