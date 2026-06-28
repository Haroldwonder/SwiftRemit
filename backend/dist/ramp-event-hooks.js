"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.rampHooks = void 0;
exports.hookNameForStatus = hookNameForStatus;
class RampEventHooks {
    handlers = new Map();
    on(hook, handler) {
        const list = this.handlers.get(hook) ?? [];
        list.push(handler);
        this.handlers.set(hook, list);
    }
    off(hook, handler) {
        const list = this.handlers.get(hook) ?? [];
        this.handlers.set(hook, list.filter((h) => h !== handler));
    }
    async emit(hook, event) {
        const list = this.handlers.get(hook) ?? [];
        await Promise.all(list.map((h) => h(event)));
    }
}
/** Singleton hook registry — import this in any module that needs to subscribe or emit. */
exports.rampHooks = new RampEventHooks();
const STATUS_HOOK = {
    pending: 'order.pending',
    processing: 'order.processing',
    completed: 'order.completed',
    failed: 'order.failed',
    refunded: 'order.refunded',
    cancelled: 'order.cancelled',
};
function hookNameForStatus(status) {
    return STATUS_HOOK[status];
}
