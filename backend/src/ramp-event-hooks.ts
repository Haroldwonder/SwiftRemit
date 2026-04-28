/**
 * Event hook registry for fiat on/off ramp provider callbacks.
 *
 * Consumers subscribe to named hooks; the ramp webhook endpoint emits
 * events through this registry so multiple handlers can react without
 * coupling to the HTTP layer.
 *
 * Usage:
 *   rampHooks.on('order.completed', async (event) => { ... });
 *   // In webhook handler:
 *   await rampHooks.emit(hookNameForStatus(event.status), event);
 */

import { RampOrderEvent, RampOrderStatus } from './ramp-provider';

export type RampHookName =
  | 'order.pending'
  | 'order.processing'
  | 'order.completed'
  | 'order.failed'
  | 'order.refunded'
  | 'order.cancelled';

export type RampHookHandler = (event: RampOrderEvent) => Promise<void>;

class RampEventHooks {
  private handlers = new Map<RampHookName, RampHookHandler[]>();

  on(hook: RampHookName, handler: RampHookHandler): void {
    const list = this.handlers.get(hook) ?? [];
    list.push(handler);
    this.handlers.set(hook, list);
  }

  off(hook: RampHookName, handler: RampHookHandler): void {
    const list = this.handlers.get(hook) ?? [];
    this.handlers.set(hook, list.filter((h) => h !== handler));
  }

  async emit(hook: RampHookName, event: RampOrderEvent): Promise<void> {
    const list = this.handlers.get(hook) ?? [];
    await Promise.all(list.map((h) => h(event)));
  }
}

/** Singleton hook registry — import this in any module that needs to subscribe or emit. */
export const rampHooks = new RampEventHooks();

const STATUS_HOOK: Record<RampOrderStatus, RampHookName> = {
  pending: 'order.pending',
  processing: 'order.processing',
  completed: 'order.completed',
  failed: 'order.failed',
  refunded: 'order.refunded',
  cancelled: 'order.cancelled',
};

export function hookNameForStatus(status: RampOrderStatus): RampHookName {
  return STATUS_HOOK[status];
}
