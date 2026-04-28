import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebhookDispatcher } from '../webhook-dispatcher';
import {
  enqueueWebhookDelivery,
  getActiveWebhookSubscribers,
  getPendingWebhookDeliveries,
  markWebhookDeliveryFailure,
  markWebhookDeliverySuccess,
} from '../database';
import { WebhookDelivery } from '../types';

vi.mock('../database', () => ({
  getActiveWebhookSubscribers: vi.fn(),
  enqueueWebhookDelivery: vi.fn(),
  getPendingWebhookDeliveries: vi.fn(),
  markWebhookDeliveryFailure: vi.fn(),
  markWebhookDeliverySuccess: vi.fn(),
}));

const subscriberA = {
  id: 'sub-1',
  url: 'https://subscriber-a.test/webhook',
  secret: null,
  active: true,
  created_at: new Date(),
  updated_at: new Date(),
};

const subscriberB = {
  id: 'sub-2',
  url: 'https://subscriber-b.test/webhook',
  secret: null,
  active: true,
  created_at: new Date(),
  updated_at: new Date(),
};

function makeDelivery(id: string, targetUrl: string, attempts = 0): WebhookDelivery {
  return {
    id,
    event_type: 'remittance.created',
    event_key: '42',
    subscriber_id: `sub-${id}`,
    target_url: targetUrl,
    payload: {
      remittance_id: '42',
      sender: 'GSENDER',
      agent: 'GAGENT',
      amount: '10000000',
      fee: '100000',
      expiry: '1777777777',
    },
    status: 'pending',
    attempt_count: attempts,
    max_attempts: 5,
    next_retry_at: new Date(),
    last_error: null,
    response_status: null,
    delivered_at: null,
  };
}

describe('WebhookDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches remittance.created to all active subscribers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    vi.mocked(getActiveWebhookSubscribers).mockResolvedValue([subscriberA, subscriberB]);
    vi.mocked(enqueueWebhookDelivery)
      .mockResolvedValueOnce(makeDelivery('1', subscriberA.url))
      .mockResolvedValueOnce(makeDelivery('2', subscriberB.url));

    const dispatcher = new WebhookDispatcher(fetchMock as unknown as typeof fetch);
    await dispatcher.dispatchRemittanceCreated({
      remittance_id: '42',
      sender: 'GSENDER',
      agent: 'GAGENT',
      amount: '10000000',
      fee: '100000',
      expiry: '1777777777',
    });

    expect(getActiveWebhookSubscribers).toHaveBeenCalledTimes(1);
    expect(enqueueWebhookDelivery).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(markWebhookDeliverySuccess).toHaveBeenCalledTimes(2);
  });

  it('marks failed delivery pending with incremented attempt count for retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const delivery = makeDelivery('retry-1', subscriberA.url, 0);
    vi.mocked(getPendingWebhookDeliveries).mockResolvedValue([delivery]);

    const dispatcher = new WebhookDispatcher(fetchMock as unknown as typeof fetch);
    await dispatcher.retryPendingDeliveries();

    expect(getPendingWebhookDeliveries).toHaveBeenCalledTimes(1);
    expect(markWebhookDeliveryFailure).toHaveBeenCalledTimes(1);

    const args = vi.mocked(markWebhookDeliveryFailure).mock.calls[0];
    expect(args[0]).toBe(delivery.id);
    expect(args[1]).toBe(1);
    expect(args[2]).toBe(5);
    expect(args[4]).toContain('status 500');
    expect(args[5]).toBe(500);
  });
});
