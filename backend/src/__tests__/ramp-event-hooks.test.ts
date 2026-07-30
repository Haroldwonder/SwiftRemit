import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  rampHooks,
  hookNameForStatus,
  RampHookName,
  RampHookHandler,
} from '../ramp-event-hooks';
import { RampOrderEvent, RampOrderStatus } from '../ramp-provider';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEvent(status: RampOrderStatus): RampOrderEvent {
  return {
    orderId:    'ord-1',
    provider:   'moonpay',
    status,
    fiatAmount: 100,
    fiatCurrency: 'USD',
    cryptoAmount: 50,
    cryptoCurrency: 'USDC',
    walletAddress: 'GABC',
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
    raw: {},
  };
}

// Clear all handlers between tests by removing them explicitly
let registered: Array<{ hook: RampHookName; handler: RampHookHandler }> = [];

beforeEach(() => {
  for (const { hook, handler } of registered) {
    rampHooks.off(hook, handler);
  }
  registered = [];
});

// ── hookNameForStatus ─────────────────────────────────────────────────────────

describe('hookNameForStatus', () => {
  const CASES: Array<[RampOrderStatus, RampHookName]> = [
    ['pending',    'order.pending'],
    ['processing', 'order.processing'],
    ['completed',  'order.completed'],
    ['failed',     'order.failed'],
    ['refunded',   'order.refunded'],
    ['cancelled',  'order.cancelled'],
  ];

  for (const [status, expected] of CASES) {
    it(`maps "${status}" → "${expected}"`, () => {
      expect(hookNameForStatus(status)).toBe(expected);
    });
  }
});

// ── on / emit ─────────────────────────────────────────────────────────────────

describe('rampHooks.on + emit', () => {
  it('calls a registered handler with the event', async () => {
    const handler: RampHookHandler = vi.fn().mockResolvedValue(undefined);
    rampHooks.on('order.completed', handler);
    registered.push({ hook: 'order.completed', handler });

    const event = makeEvent('completed');
    await rampHooks.emit('order.completed', event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('calls multiple handlers registered for the same hook', async () => {
    const h1: RampHookHandler = vi.fn().mockResolvedValue(undefined);
    const h2: RampHookHandler = vi.fn().mockResolvedValue(undefined);
    rampHooks.on('order.failed', h1);
    rampHooks.on('order.failed', h2);
    registered.push({ hook: 'order.failed', handler: h1 });
    registered.push({ hook: 'order.failed', handler: h2 });

    await rampHooks.emit('order.failed', makeEvent('failed'));

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('does not call handlers registered for a different hook', async () => {
    const handler: RampHookHandler = vi.fn().mockResolvedValue(undefined);
    rampHooks.on('order.refunded', handler);
    registered.push({ hook: 'order.refunded', handler });

    await rampHooks.emit('order.completed', makeEvent('completed'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('does nothing when no handlers are registered', async () => {
    await expect(rampHooks.emit('order.cancelled', makeEvent('cancelled'))).resolves.toBeUndefined();
  });

  it('propagates a handler rejection', async () => {
    const handler: RampHookHandler = vi.fn().mockRejectedValue(new Error('handler error'));
    rampHooks.on('order.pending', handler);
    registered.push({ hook: 'order.pending', handler });

    await expect(rampHooks.emit('order.pending', makeEvent('pending'))).rejects.toThrow('handler error');
  });
});

// ── off ───────────────────────────────────────────────────────────────────────

describe('rampHooks.off', () => {
  it('removes a specific handler', async () => {
    const h1: RampHookHandler = vi.fn().mockResolvedValue(undefined);
    const h2: RampHookHandler = vi.fn().mockResolvedValue(undefined);
    rampHooks.on('order.processing', h1);
    rampHooks.on('order.processing', h2);
    registered.push({ hook: 'order.processing', handler: h2 }); // only track h2 for cleanup

    rampHooks.off('order.processing', h1); // remove h1 manually now

    await rampHooks.emit('order.processing', makeEvent('processing'));

    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('is a no-op when removing a handler that was never registered', () => {
    const handler: RampHookHandler = vi.fn().mockResolvedValue(undefined);
    expect(() => rampHooks.off('order.completed', handler)).not.toThrow();
  });
});
