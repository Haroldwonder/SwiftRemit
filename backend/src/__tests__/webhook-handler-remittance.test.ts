import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

const dispatchRemittanceCreated = vi.fn();

vi.mock('../webhook-dispatcher', () => ({
  WebhookDispatcher: vi.fn().mockImplementation(() => ({
    dispatchRemittanceCreated,
  })),
}));

import { WebhookHandler } from '../webhook-handler';

function buildMockPool(secret: string): Pool {
  return {
    query: vi.fn(async (sql: string) => {
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
    }),
  } as unknown as Pool;
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

    const rawBody = JSON.stringify(body);
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const req: any = {
      headers: {
        'x-signature': signature,
        'x-timestamp': new Date().toISOString(),
        'x-nonce': crypto.randomUUID(),
        'x-anchor-id': 'anchor-test',
      },
      body,
      rawBody,
    };

    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    const handler = new WebhookHandler(buildMockPool(secret));
    await handler.handleWebhook(req, res);

    expect(dispatchRemittanceCreated).toHaveBeenCalledTimes(1);
    expect(dispatchRemittanceCreated).toHaveBeenCalledWith({
      remittance_id: '99',
      sender: 'GSENDERADDRESS',
      agent: 'GAGENTADDRESS',
      amount: '10000000',
      fee: '100000',
      expiry: '1777777777',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
