/**
 * Socket.IO event handlers for remittance status rooms.
 *
 * Room naming convention: `remittance:{id}`
 *
 * Flow:
 *   1. Client connects (auth middleware already validated JWT)
 *   2. Client emits `remittance:join` with { remittanceId }
 *   3. Server validates ownership, then joins the socket to the room
 *   4. Server emits `status:updated` to the room on every status change
 *   5. Socket.IO automatically removes the socket from all rooms on disconnect
 */

import { Server, Socket } from 'socket.io';
import { StatusUpdatedPayload } from '../types';

/** Request payload for joining a remittance room */
interface JoinRoomPayload {
  remittanceId: string;
}

/** Acknowledgement callback shape (optional — client may omit it) */
type AckCallback = (response: { success: boolean; error?: string }) => void;

/**
 * Returns the canonical room name for a remittance.
 */
export function remittanceRoom(remittanceId: string): string {
  return `remittance:${remittanceId}`;
}

/**
 * Checks whether the authenticated user is allowed to watch a remittance.
 *
 * Returns true if:
 *   - The user has no allowlists (admin / service token)
 *   - The user is the sender and the remittanceId is in their remittanceIds
 *   - The user is an agent and the remittanceId is in their agentRemittanceIds
 */
function userCanAccessRemittance(socket: Socket, remittanceId: string): boolean {
  const { user } = socket.data;

  if (!user) return false;

  const hasSenderList = user.remittanceIds && user.remittanceIds.length > 0;
  const hasAgentList = user.agentRemittanceIds && user.agentRemittanceIds.length > 0;

  // No allowlists on the token → grant access (admin / service token)
  if (!hasSenderList && !hasAgentList) {
    return true;
  }

  // Grant access if the user is the sender of this remittance
  if (hasSenderList && user.remittanceIds!.includes(remittanceId)) {
    return true;
  }

  // Grant access if the user is the assigned agent for this remittance
  if (hasAgentList && user.agentRemittanceIds!.includes(remittanceId)) {
    return true;
  }

  return false;
}

/**
 * Registers all remittance-related Socket.IO event handlers for a socket.
 *
 * Called once per connection from the main WebSocket setup.
 */
export function registerRemittanceHandlers(io: Server, socket: Socket): void {
  // ── remittance:join ────────────────────────────────────────────────────────
  socket.on('remittance:join', (payload: JoinRoomPayload, ack?: AckCallback) => {
    const remittanceId =
      typeof payload?.remittanceId === 'string' ? payload.remittanceId.trim() : '';

    if (!remittanceId) {
      const error = 'remittanceId is required';
      if (typeof ack === 'function') ack({ success: false, error });
      return;
    }

    if (!userCanAccessRemittance(socket, remittanceId)) {
      const error = `403: Not authorized to watch remittance ${remittanceId}`;
      if (typeof ack === 'function') ack({ success: false, error });
      // Disconnect to prevent probing
      socket.disconnect(true);
      return;
    }

    const room = remittanceRoom(remittanceId);
    socket.join(room);

    if (typeof ack === 'function') ack({ success: true });
  });

  // ── remittance:leave ───────────────────────────────────────────────────────
  socket.on('remittance:leave', (payload: JoinRoomPayload, ack?: AckCallback) => {
    const remittanceId =
      typeof payload?.remittanceId === 'string' ? payload.remittanceId.trim() : '';

    if (!remittanceId) {
      if (typeof ack === 'function') ack({ success: false, error: 'remittanceId is required' });
      return;
    }

    const room = remittanceRoom(remittanceId);
    socket.leave(room);

    if (typeof ack === 'function') ack({ success: true });
  });

  // Socket.IO automatically removes the socket from all rooms on disconnect —
  // no manual cleanup needed. Log for observability.
  socket.on('disconnect', (reason) => {
    // Rooms are cleaned up by Socket.IO internally.
    // This handler is intentionally lightweight.
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[ws] socket ${socket.id} disconnected: ${reason}`);
    }
  });
}

/**
 * Broadcasts a status update to all sockets in the remittance's room.
 *
 * Called by the WebSocket index when the remittanceEventBus fires.
 */
export function broadcastStatusUpdate(
  io: Server,
  payload: StatusUpdatedPayload,
): void {
  const room = remittanceRoom(payload.remittanceId);
  io.to(room).emit('status:updated', payload);
}
