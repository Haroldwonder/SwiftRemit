import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import {
  deliverWebhook,
  getDLQ,
  clearDLQ,
  WebhookPayload,
} from '../services/webhook';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const samplePayload: WebhookPayload = {
  event: 'remittance.completed',
  txId: 'TX-001',
  status: 'completed',
  amount: 250,
  currency: 'USDC',
  timestamp: '2024-06-01T10:00:00Z',
};

const ENDPOINT = 'http://example.com/webhooks';

beforeEach(() => {
  vi.clearAllMocks();
  clearDLQ();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deliverWebhook', () => {
  it('returns success on first attempt when endpoint responds 200', async () => {
    mockedAxios.post = vi.fn().mockResolvedValueOnce({ status: 200 });

    const promise = deliverWebhook(ENDPOINT, samplePayload, {
      maxRetries: 3,
      baseDelayMs: 100,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.dlq).toBe(false);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 and succeeds on second attempt', async () => {
    mockedAxios.post = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('503'), { response: { status: 503 } }))
      .mockResolvedValueOnce({ status: 200 });

    const promise = deliverWebhook(ENDPOINT, samplePayload, {
      maxRetries: 3,
      baseDelayMs: 10,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.dlq).toBe(false);
  });

  it('sends to DLQ after exhausting all retries', async () => {
    const networkError = Object.assign(new Error('ECONNRESET'), {
      code: 'ECONNRESET',
    });
    mockedAxios.post = vi.fn().mockRejectedValue(networkError);

    const promise = deliverWebhook(ENDPOINT, samplePayload, {
      maxRetries: 2,
      baseDelayMs: 10,
      maxDelayMs: 100,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.dlq).toBe(true);
    expect(result.attempts).toBe(3);

    const dlq = getDLQ();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].payload.txId).toBe('TX-001');
    expect(dlq[0].attempts).toBe(3);
  });

  it('does not retry on 4xx client error', async () => {
    const clientError = Object.assign(new Error('Bad Request'), {
      response: { status: 400 },
    });
    mockedAxios.post = vi.fn().mockRejectedValueOnce(clientError);

    const promise = deliverWebhook(ENDPOINT, samplePayload, {
      maxRetries: 3,
      baseDelayMs: 10,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.dlq).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('sends correct headers', async () => {
    mockedAxios.post = vi.fn().mockResolvedValueOnce({ status: 200 });

    const promise = deliverWebhook(ENDPOINT, samplePayload, { maxRetries: 0 });
    await vi.runAllTimersAsync();
    await promise;

    expect(mockedAxios.post).toHaveBeenCalledWith(
      ENDPOINT,
      samplePayload,
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-SwiftRemit-Event': 'remittance.completed',
          'X-SwiftRemit-TxId': 'TX-001',
        }),
      }),
    );
  });

  it('accumulates multiple failed webhooks in DLQ independently', async () => {
    mockedAxios.post = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));

    const p1 = deliverWebhook(ENDPOINT, { ...samplePayload, txId: 'TX-A' }, { maxRetries: 0 });
    const p2 = deliverWebhook(ENDPOINT, { ...samplePayload, txId: 'TX-B' }, { maxRetries: 0 });
    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    const dlq = getDLQ();
    expect(dlq).toHaveLength(2);
    expect(dlq.map((e) => e.payload.txId)).toContain('TX-A');
    expect(dlq.map((e) => e.payload.txId)).toContain('TX-B');
  });
});
