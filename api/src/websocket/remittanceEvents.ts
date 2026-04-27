/**
 * In-process event bus for remittance status changes.
 *
 * Any part of the application that changes a remittance's status calls
 * `emitStatusChange()`. The WebSocket layer subscribes once at startup
 * and forwards the event to the appropriate Socket.IO room.
 *
 * Using Node's built-in EventEmitter keeps this dependency-free and
 * synchronous — the WebSocket emit happens in the same event-loop tick
 * as the status change.
 */

import { EventEmitter } from 'events';
import { RemittanceStatus, StatusUpdatedPayload } from './types';

const REMITTANCE_STATUS_EVENT = 'remittance:status:updated';

class RemittanceEventBus extends EventEmitter {}

/** Singleton event bus — import this anywhere you need to emit or listen */
export const remittanceEventBus = new RemittanceEventBus();

/**
 * Emit a status change event.
 *
 * Call this from your service/repository layer immediately after persisting
 * the new status to the database.
 *
 * @example
 *   await db.updateRemittanceStatus(id, newStatus);
 *   emitStatusChange(id, newStatus);
 */
export function emitStatusChange(
  remittanceId: string,
  status: RemittanceStatus,
): void {
  const payload: StatusUpdatedPayload = {
    remittanceId,
    status,
    updatedAt: new Date().toISOString(),
  };
  remittanceEventBus.emit(REMITTANCE_STATUS_EVENT, payload);
}

/**
 * Subscribe to remittance status change events.
 *
 * @returns Unsubscribe function — call it to remove the listener.
 */
export function onStatusChange(
  handler: (payload: StatusUpdatedPayload) => void,
): () => void {
  remittanceEventBus.on(REMITTANCE_STATUS_EVENT, handler);
  return () => remittanceEventBus.off(REMITTANCE_STATUS_EVENT, handler);
}

export { REMITTANCE_STATUS_EVENT };
