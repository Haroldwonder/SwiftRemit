/**
 * SR-035 — Correlation ID propagation tests
 *
 * Covers:
 *   - Scheduled job: correlation ID generated, stored in job_runs, and
 *     available via getCorrelationId() inside the job body.
 *   - Webhook delivery: X-Correlation-ID header present on outbound HTTP.
 *   - WebSocket push: correlationId field present in emitted payload.
 *   - Contract-event / remittance event: correlationId threaded from
 *     emitStatusChange → webhook service call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Shared mocks ────────────────────────────────────────────────────────────

vi.mock('uuid', () => ({ v4: () => 'test-correlation-uuid' }));
vi.mock('../metrics', () => ({
  getMetricsService: () => ({
    recordJobRun: vi.fn(),
    recordJobFailure: vi.fn(),
  }),
}));

// ─── 1. Job-tracker: correlation ID generated and available inside job body ──

describe('runTracked (SR-035)', () => {
  it('generates a correlation ID, writes it to job_runs, and exposes it via getCorrelationId()', async () => {
    const { correlationStorage } = await import('../correlation-id');
    const { runTracked } = await import('../job-tracker');

    let capturedId: string | undefined;

    // Minimal pool mock
    const pool = {
      query: vi.fn()
        // INSERT … RETURNING id
        .mockResolvedValueOnce({ rows: [{ id: 42 }] })
        // UPDATE … status = 'success'
        .mockResolvedValueOnce({ rows: [] }),
    } as any;

    await runTracked(pool, 'test-job', async () => {
      capturedId = correlationStorage.getStore();
    });

    // The INSERT should include the generated correlation ID
    const insertCall = pool.query.mock.calls[0];
    expect(insertCall[0]).toMatch(/INSERT INTO job_runs/);
    expect(insertCall[1]).toEqual(['test-job', 'test-correlation-uuid']);

    // The job body ran inside the ALS context
    expect(capturedId).toBe('test-correlation-uuid');
  });

  it('marks the job as failure and rethrows when the job throws', async () => {
    const { runTracked } = await import('../job-tracker');

    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })   // INSERT
        .mockResolvedValueOnce({ rows: [] }),             // UPDATE failure
    } as any;

    await expect(
      runTracked(pool, 'failing-job', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const updateCall = pool.query.mock.calls[1];
    expect(updateCall[0]).toMatch(/status = 'failure'/);
    expect(updateCall[1][1]).toBe('boom');
  });
});

// ─── 2. Webhook dispatcher: X-Correlation-ID header on outbound HTTP ─────────

describe('WebhookDispatcher – X-Correlation-ID header (SR-035)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('injects X-Correlation-ID on outbound webhook delivery', async () => {
    // Mock axios so no real HTTP call is made
    vi.doMock('axios', () => ({
      default: {
        post: vi.fn().mockResolvedValue({ status: 200, statusText: 'OK' }),
      },
    }));

    const { WebhookDispatcher } = await import('../webhooks/dispatcher');

    const store = {
      getSubscribers: vi.fn().mockResolvedValue([
        { id: 'sub-1', url: 'https://example.com/webhook', secret: 'secret123', content_type: 'application/json' },
      ]),
      recordDelivery: vi.fn().mockResolvedValue('delivery-1'),
      updateDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      sendToDeadLetter: vi.fn().mockResolvedValue(undefined),
      getWebhook: vi.fn().mockResolvedValue(null),
      getPendingDeliveries: vi.fn().mockResolvedValue([]),
    } as any;

    const dispatcher = new WebhookDispatcher(store);
    await dispatcher.dispatch(
      'remittance.completed',
      { event: 'remittance.completed', timestamp: new Date().toISOString(), data: {} },
      'cid-from-sr035',
    );

    const axios = (await import('axios')).default as any;
    expect(axios.post).toHaveBeenCalledOnce();
    const [, , callConfig] = axios.post.mock.calls[0];
    expect(callConfig.headers['X-Correlation-ID']).toBe('cid-from-sr035');
  });

  it('omits X-Correlation-ID when no correlation ID is provided', async () => {
    vi.doMock('axios', () => ({
      default: {
        post: vi.fn().mockResolvedValue({ status: 200, statusText: 'OK' }),
      },
    }));

    const { WebhookDispatcher } = await import('../webhooks/dispatcher');

    const store = {
      getSubscribers: vi.fn().mockResolvedValue([
        { id: 'sub-2', url: 'https://example.com/webhook', secret: 'secret123', content_type: 'application/json' },
      ]),
      recordDelivery: vi.fn().mockResolvedValue('delivery-2'),
      updateDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      sendToDeadLetter: vi.fn().mockResolvedValue(undefined),
      getWebhook: vi.fn().mockResolvedValue(null),
      getPendingDeliveries: vi.fn().mockResolvedValue([]),
    } as any;

    const dispatcher = new WebhookDispatcher(store);
    await dispatcher.dispatch(
      'remittance.completed',
      { event: 'remittance.completed', timestamp: new Date().toISOString(), data: {} },
      // no correlationId
    );

    const axios = (await import('axios')).default as any;
    const [, , callConfig] = axios.post.mock.calls[0];
    expect(callConfig.headers['X-Correlation-ID']).toBeUndefined();
  });
});

// ─── 3. WebSocket: correlationId present in emitted payload ──────────────────

describe('emitToSenderRoom – correlationId in payload (SR-035)', () => {
  it('includes correlationId in the emitted socket event', () => {
    const emitted: any[] = [];
    const fakeIo = {
      to: () => ({
        emit: (_event: string, payload: any) => emitted.push(payload),
      }),
    } as any;

    // Import synchronously — no async mocking needed for this pure function
    const { emitToSenderRoom } = require('../websocket-subscription');

    emitToSenderRoom(fakeIo, 'GADDR1', {
      remittanceId: 'rem-001',
      status: 'completed',
      timestamp: new Date(),
      correlationId: 'cid-ws-test',
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].correlationId).toBe('cid-ws-test');
  });

  it('omits correlationId field when not provided', () => {
    const emitted: any[] = [];
    const fakeIo = {
      to: () => ({
        emit: (_event: string, payload: any) => emitted.push(payload),
      }),
    } as any;

    const { emitToSenderRoom } = require('../websocket-subscription');

    emitToSenderRoom(fakeIo, 'GADDR2', {
      remittanceId: 'rem-002',
      status: 'pending',
      timestamp: new Date(),
    });

    expect(emitted[0].correlationId).toBeUndefined();
  });
});

// ─── 4. RemittanceEventEmitter: correlationId forwarded to webhook service ───

describe('RemittanceEventEmitter.emitStatusChange – correlation ID threading (SR-035)', () => {
  it('passes the explicit correlationId to the webhook service', async () => {
    const { RemittanceEventEmitter } = await import('../remittance/events');

    const mockWebhookService = {
      onRemittanceStatusChange: vi.fn().mockResolvedValue({ success: 1, failed: 0 }),
    } as any;

    const emitter = new RemittanceEventEmitter();
    emitter.setWebhookService(mockWebhookService);

    await emitter.emitStatusChange({
      remittanceId: 'rem-003',
      status: 'completed',
      amount: 100,
      currency: 'USDC',
      recipientId: 'user-abc',
      timestamp: new Date(),
      correlationId: 'cid-event-test',
    });

    expect(mockWebhookService.onRemittanceStatusChange).toHaveBeenCalledOnce();
    const args = mockWebhookService.onRemittanceStatusChange.mock.calls[0];
    // 4th argument is the correlationId
    expect(args[3]).toBe('cid-event-test');
  });

  it('falls back to getCorrelationId() when no explicit correlationId is given', async () => {
    const { correlationStorage } = await import('../correlation-id');
    const { RemittanceEventEmitter } = await import('../remittance/events');

    const mockWebhookService = {
      onRemittanceStatusChange: vi.fn().mockResolvedValue({ success: 1, failed: 0 }),
    } as any;

    const emitter = new RemittanceEventEmitter();
    emitter.setWebhookService(mockWebhookService);

    await correlationStorage.run('cid-ambient', async () => {
      await emitter.emitStatusChange({
        remittanceId: 'rem-004',
        status: 'failed',
        amount: 50,
        currency: 'USDC',
        recipientId: 'user-xyz',
        timestamp: new Date(),
        // no explicit correlationId — should pick up from ALS
      });
    });

    const args = mockWebhookService.onRemittanceStatusChange.mock.calls[0];
    expect(args[3]).toBe('cid-ambient');
  });
});
