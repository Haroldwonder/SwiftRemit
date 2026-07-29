import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { handleRampWebhook } from '../ramp-webhook-handler';
import * as rampProvider from '../ramp-provider';
import * as rampEventHooks from '../ramp-event-hooks';
import { RampOrderEvent } from '../ramp-provider';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEvent(status = 'completed'): RampOrderEvent {
  return {
    orderId: 'ord-1',
    provider: 'moonpay',
    status: status as any,
    fiatAmount: 100,
    fiatCurrency: 'USD',
    cryptoAmount: 50,
    cryptoCurrency: 'USDC',
    walletAddress: 'GABC',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    raw: {},
  };
}

interface RawBodyRequest extends Request { rawBody?: string }

function makeReq(providerName: string, body: Record<string, unknown> = {}, rawBody?: string): RawBodyRequest {
  return {
    params:  { provider: providerName },
    headers: { 'x-signature': 'sig' },
    body,
    rawBody,
  } as unknown as RawBodyRequest;
}

function makeRes() {
  const json   = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json } as unknown as Response;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('handleRampWebhook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 404 for an unknown provider', async () => {
    vi.spyOn(rampProvider, 'getProvider').mockReturnValue(undefined as any);
    const res = makeRes();
    await handleRampWebhook(makeReq('unknown'), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 401 when signature verification fails', async () => {
    const provider = { verifyWebhook: vi.fn().mockReturnValue(false), parseEvent: vi.fn() };
    vi.spyOn(rampProvider, 'getProvider').mockReturnValue(provider as any);

    const res = makeRes();
    await handleRampWebhook(makeReq('moonpay', {}, '{"raw":"body"}'), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(provider.parseEvent).not.toHaveBeenCalled();
  });

  it('returns 200 and emits the hook on success', async () => {
    const event    = makeEvent('completed');
    const provider = {
      verifyWebhook: vi.fn().mockReturnValue(true),
      parseEvent:    vi.fn().mockReturnValue(event),
    };
    vi.spyOn(rampProvider, 'getProvider').mockReturnValue(provider as any);
    vi.spyOn(rampEventHooks, 'hookNameForStatus').mockReturnValue('order.completed');
    const emitSpy = vi.spyOn(rampEventHooks.rampHooks, 'emit').mockResolvedValue();

    const res = makeRes();
    await handleRampWebhook(makeReq('moonpay', { status: 'completed' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(emitSpy).toHaveBeenCalledWith('order.completed', event);
  });

  it('uses rawBody when available for signature verification', async () => {
    const provider = {
      verifyWebhook: vi.fn().mockReturnValue(true),
      parseEvent:    vi.fn().mockReturnValue(makeEvent()),
    };
    vi.spyOn(rampProvider, 'getProvider').mockReturnValue(provider as any);
    vi.spyOn(rampEventHooks.rampHooks, 'emit').mockResolvedValue();

    const rawBody = '{"status":"completed"}';
    await handleRampWebhook(makeReq('moonpay', {}, rawBody), makeRes());

    const verifyArg = provider.verifyWebhook.mock.calls[0][0];
    expect(verifyArg).toBe(rawBody);
  });

  it('falls back to JSON.stringify(body) when rawBody is absent', async () => {
    const body = { status: 'completed' };
    const provider = {
      verifyWebhook: vi.fn().mockReturnValue(true),
      parseEvent:    vi.fn().mockReturnValue(makeEvent()),
    };
    vi.spyOn(rampProvider, 'getProvider').mockReturnValue(provider as any);
    vi.spyOn(rampEventHooks.rampHooks, 'emit').mockResolvedValue();

    await handleRampWebhook(makeReq('moonpay', body), makeRes());

    expect(provider.verifyWebhook.mock.calls[0][0]).toBe(JSON.stringify(body));
  });

  it('returns 500 when parseEvent throws', async () => {
    const provider = {
      verifyWebhook: vi.fn().mockReturnValue(true),
      parseEvent:    vi.fn().mockImplementation(() => { throw new Error('parse failed'); }),
    };
    vi.spyOn(rampProvider, 'getProvider').mockReturnValue(provider as any);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = makeRes();
    await handleRampWebhook(makeReq('moonpay', {}), res);

    expect(res.status).toHaveBeenCalledWith(500);
    errorSpy.mockRestore();
  });

  it('returns 500 when hook emission throws', async () => {
    const provider = {
      verifyWebhook: vi.fn().mockReturnValue(true),
      parseEvent:    vi.fn().mockReturnValue(makeEvent()),
    };
    vi.spyOn(rampProvider, 'getProvider').mockReturnValue(provider as any);
    vi.spyOn(rampEventHooks.rampHooks, 'emit').mockRejectedValue(new Error('emit failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = makeRes();
    await handleRampWebhook(makeReq('moonpay', {}), res);

    expect(res.status).toHaveBeenCalledWith(500);
    errorSpy.mockRestore();
  });
});
