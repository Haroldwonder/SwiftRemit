import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

const { dispatchRemittanceCreated } = vi.hoisted(() => ({
  dispatchRemittanceCreated: vi.fn(),
}));

vi.mock('../webhook-dispatcher', () => ({
  WebhookDispatcher: vi.fn().mockImplementation(() => ({
    dispatchRemittanceCreated,
  })),
}));

vi.mock('../database', () => ({
  recordWebhookNonce: vi.fn().mockResolvedValue(true),
  purgeExpiredWebhookNonces: vi.fn().mockResolvedValue(undefined),
}));

import { WebhookHandler } from '../webhook-handler';

function buildMockPool(secret: string): Pool {
  const querySpy = vi.fn(async (sql: string) => {
    const normalized = sql.toUpperCase();
    if (normalized.includes('FROM ANCHORS')) {
      return { rows: [{ public_key: null, webhook_secret: secret }] } as any;
    }
    if (normalized.includes('INSERT INTO WEBHOOK_LOGS')) {
      return { rows: [{ id: 'wh-log-1' }] } as any;
    }
    if (normalized.includes('FROM WEBHOOK_LOGS')) {
      return { rows: [{ count: '0' }] } as any;
    }
    if (normalized.includes('SUSPICIOUS_WEBHOOKS')) {
      return { rows: [] } as any;
    }
    return { rows: [] } as any;
  });
  return { query: querySpy } as unknown as Pool;
}

function buildRequest(body: Record<string, unknown>, secret: string) {
  const rawBody = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return {
    req: {
      headers: {
        'x-signature': signature,
        'x-timestamp': new Date().toISOString(),
        'x-nonce': crypto.randomUUID(),
        'x-anchor-id': 'anchor-test',
      },
      body,
      rawBody,
    } as any,
    res: {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any,
  };
}

describe('WebhookHandler remittance created flow', () => {
  it('dispatches remittance.created payload with required fields', async () => {
    dispatchRemittanceCreated.mockReset();

    const secret = 'handler-remittance-secret';
    const body = {
      event_type: 'contract_created',
      remittance_id: '99',
      sender: 'GSENDERADDRESS',
      agent: 'GAGENTADDRESS',
      amount: '10000000',
      fee: '100000',
      expiry: '1777777777',
    };

    const { req, res } = buildRequest(body, secret);
    const handler = new WebhookHandler(buildMockPool(secret));
    await handler.handleWebhook(req, res);

    expect(dispatchRemittanceCreated).toHaveBeenCalledTimes(1);
    expect(dispatchRemittanceCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        remittance_id: '99',
        sender: 'GSENDERADDRESS',
        agent: 'GAGENTADDRESS',
        amount: '10000000',
        fee: '100000',
        expiry: '1777777777',
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('includes fee breakdown fields when present in the event', async () => {
    dispatchRemittanceCreated.mockReset();

    const secret = 'handler-remittance-secret-breakdown';
    const body = {
      event_type: 'contract_created',
      remittance_id: '42',
      sender: 'GSENDER2',
      agent: 'GAGENT2',
      amount: '5000000',
      fee: '50000',
      expiry: '1999999999',
      platform_fee: '50000',
      protocol_fee: '5000',
      net_amount: '4945000',
    };

    const { req, res } = buildRequest(body, secret);
    const pool = buildMockPool(secret);
    const handler = new WebhookHandler(pool);
    await handler.handleWebhook(req, res);

    expect(dispatchRemittanceCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        remittance_id: '42',
        platform_fee: '50000',
        protocol_fee: '5000',
        net_amount: '4945000',
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('persists fee breakdown to contract_events table', async () => {
    dispatchRemittanceCreated.mockReset();

    const secret = 'handler-persist-secret';
    const body = {
      event_type: 'contract_created',
      remittance_id: '77',
      sender: 'GSENDER3',
      agent: 'GAGENT3',
      amount: '2000000',
      fee: '20000',
      expiry: '1888888888',
      platform_fee: '20000',
      protocol_fee: '2000',
      net_amount: '1978000',
    };

    const { req, res } = buildRequest(body, secret);
    const pool = buildMockPool(secret);
    const handler = new WebhookHandler(pool);
    await handler.handleWebhook(req, res);

    const querySpy = (pool as any).query as ReturnType<typeof vi.fn>;
    const insertCall = querySpy.mock.calls.find(
      (call: any[]) =>
        typeof call[0] === 'string' &&
        call[0].toUpperCase().includes('INSERT INTO CONTRACT_EVENTS')
    );

    expect(insertCall).toBeDefined();
    const params = insertCall![1] as any[];
    expect(params[0]).toBe('remittance_created');
    expect(params[5]).toBe('20000');   // platform_fee
    expect(params[6]).toBe('2000');    // protocol_fee
    expect(params[7]).toBe('1978000'); // net_amount
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('omits breakdown fields from contract_events when not present in event', async () => {
    dispatchRemittanceCreated.mockReset();

    const secret = 'handler-no-breakdown-secret';
    const body = {
      event_type: 'contract_created',
      remittance_id: '55',
      sender: 'GSENDER4',
      agent: 'GAGENT4',
      amount: '3000000',
      fee: '30000',
      expiry: '1666666666',
    };

    const { req, res } = buildRequest(body, secret);
    const pool = buildMockPool(secret);
    const handler = new WebhookHandler(pool);
    await handler.handleWebhook(req, res);

    const querySpy = (pool as any).query as ReturnType<typeof vi.fn>;
    const insertCall = querySpy.mock.calls.find(
      (call: any[]) =>
        typeof call[0] === 'string' &&
        call[0].toUpperCase().includes('INSERT INTO CONTRACT_EVENTS')
    );

    expect(insertCall).toBeDefined();
    const params = insertCall![1] as any[];
    expect(params[5]).toBeNull(); // platform_fee
    expect(params[6]).toBeNull(); // protocol_fee
    expect(params[7]).toBeNull(); // net_amount
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
