/**
 * Tests for admin webhook DLQ management endpoints.
 * SR-237
 *
 * Covers: list pagination, replay success/failure, bulk-replay partial failures,
 * auth guards, DATABASE_URL unavailability, and item-limit caps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { createAdminRouter } from '../routes/admin';
import express, { Express } from 'express';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

let app: Express;
let mockPool: Partial<Pool>;

beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());

  mockPool = {
    query: vi.fn(),
    connect: vi.fn(),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Admin Webhook DLQ Endpoints', () => {
  const adminKey = 'test-admin-key-12345';

  beforeEach(() => {
    process.env.ADMIN_API_KEY = adminKey;
  });

  describe('GET /webhooks/dlq - List DLQ entries', () => {
    it('returns 401 without admin auth', async () => {
      app.use('/admin', createAdminRouter(mockPool as Pool));

      const res = await request(app)
        .get('/admin/webhooks/dlq')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 503 when DATABASE_URL is unset and pool is null', async () => {
      app.use('/admin', createAdminRouter(null));

      const res = await request(app)
        .get('/admin/webhooks/dlq')
        .set('x-api-key', adminKey)
        .expect(503);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DB_UNAVAILABLE');
    });

    it('returns paginated list of DLQ entries with defaults (limit=50, offset=0)', async () => {
      const mockRows = Array.from({ length: 5 }, (_, i) => ({
        id: `dlq-${i}`,
        delivery_id: `delivery-${i}`,
        webhook_id: `webhook-${i}`,
        event_type: 'remittance.completed',
        payload: { amount: 100 },
        last_error: null,
        attempts: 1,
        created_at: '2024-01-01T00:00:00Z',
        replayed_at: null,
      }));

      (mockPool.query as any).mockResolvedValueOnce({ rows: mockRows });
      app.use('/admin', createAdminRouter(mockPool as Pool));

      const res = await request(app)
        .get('/admin/webhooks/dlq')
        .set('x-api-key', adminKey)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(5);
      expect(res.body.data[0]).toHaveProperty('deliveryId');
      expect(res.body.data[0]).toHaveProperty('webhookId');

      expect((mockPool.query as any).mock.calls[0][0]).toContain('LIMIT $1 OFFSET $2');
      expect((mockPool.query as any).mock.calls[0][1]).toEqual([50, 0]);
    });

    it('respects custom limit and offset', async () => {
      (mockPool.query as any).mockResolvedValueOnce({ rows: [] });
      app.use('/admin', createAdminRouter(mockPool as Pool));

      await request(app)
        .get('/admin/webhooks/dlq?limit=25&offset=100')
        .set('x-api-key', adminKey)
        .expect(200);

      expect((mockPool.query as any).mock.calls[0][1]).toEqual([25, 100]);
    });

    it('caps limit at 100 (max)', async () => {
      (mockPool.query as any).mockResolvedValueOnce({ rows: [] });
      app.use('/admin', createAdminRouter(mockPool as Pool));

      await request(app)
        .get('/admin/webhooks/dlq?limit=200')
        .set('x-api-key', adminKey)
        .expect(200);

      expect((mockPool.query as any).mock.calls[0][1][0]).toBe(100);
    });

    it('handles invalid limit gracefully', async () => {
      (mockPool.query as any).mockResolvedValueOnce({ rows: [] });
      app.use('/admin', createAdminRouter(mockPool as Pool));

      await request(app)
        .get('/admin/webhooks/dlq?limit=invalid')
        .set('x-api-key', adminKey)
        .expect(200);

      expect((mockPool.query as any).mock.calls[0][1][0]).toBe(50);
    });
  });

  describe('POST /webhooks/dlq/:id/replay - Replay single entry', () => {
    it('returns 401 without admin auth', async () => {
      app.use('/admin', createAdminRouter(mockPool as Pool));

      const res = await request(app)
        .post('/admin/webhooks/dlq/dlq-1/replay')
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 503 when DATABASE_URL is unset', async () => {
      app.use('/admin', createAdminRouter(null));

      const res = await request(app)
        .post('/admin/webhooks/dlq/dlq-1/replay')
        .set('x-api-key', adminKey)
        .expect(503);

      expect(res.body.error.code).toBe('DB_UNAVAILABLE');
    });

    it('returns 404 for nonexistent DLQ entry', async () => {
      (mockPool.query as any).mockResolvedValueOnce({ rows: [] });
      app.use('/admin', createAdminRouter(mockPool as Pool));

      const res = await request(app)
        .post('/admin/webhooks/dlq/nonexistent-id/replay')
        .set('x-api-key', adminKey)
        .expect(404);

      expect(res.body.error.code).toBe('DLQ_ENTRY_NOT_FOUND');
    });

    it('successfully replays and marks entry as replayed', async () => {
      const dlqEntry = {
        id: 'dlq-1',
        webhook_id: 'wh-1',
        payload: { amount: 100 },
        last_error: null,
        attempts: 1,
      };

      const webhook = {
        id: 'wh-1',
        url: 'https://example.com/webhook',
        secret: 'secret-key',
        active: true,
      };

      (mockPool.query as any)
        .mockResolvedValueOnce({ rows: [dlqEntry] })
        .mockResolvedValueOnce({ rows: [webhook] })
        .mockResolvedValueOnce({ rows: [] });

      mockedAxios.post.mockResolvedValueOnce({ status: 200 });

      app.use('/admin', createAdminRouter(mockPool as Pool));

      const res = await request(app)
        .post('/admin/webhooks/dlq/dlq-1/replay')
        .set('x-api-key', adminKey)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.replayed).toBe(true);

      const updateCall = (mockPool.query as any).mock.calls[2];
      expect(updateCall[0]).toContain('UPDATE webhook_dead_letters');
      expect(updateCall[0]).toContain('replayed_at');
    });

    it('records error and does not mark as replayed on delivery failure', async () => {
      const dlqEntry = {
        id: 'dlq-1',
        webhook_id: 'wh-1',
        payload: { amount: 100 },
      };

      const webhook = {
        id: 'wh-1',
        url: 'https://example.com/webhook',
        secret: 'secret-key',
        active: true,
      };

      (mockPool.query as any)
        .mockResolvedValueOnce({ rows: [dlqEntry] })
        .mockResolvedValueOnce({ rows: [webhook] })
        .mockResolvedValueOnce({ rows: [] });

      mockedAxios.post.mockResolvedValueOnce({ status: 500, statusText: 'Internal Server Error' });

      app.use('/admin', createAdminRouter(mockPool as Pool));

      const res = await request(app)
        .post('/admin/webhooks/dlq/dlq-1/replay')
        .set('x-api-key', adminKey)
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DLQ_REPLAY_FAILED');

      const updateCall = (mockPool.query as any).mock.calls[2];
      expect(updateCall[0]).toContain('last_error');
      expect(updateCall[0]).toContain('attempts = attempts + 1');
    });

    it('handles network errors during replay', async () => {
      const dlqEntry = {
        id: 'dlq-1',
        webhook_id: 'wh-1',
        payload: { amount: 100 },
      };

      const webhook = {
        id: 'wh-1',
        url: 'https://example.com/webhook',
        secret: 'secret-key',
        active: true,
      };

      (mockPool.query as any)
        .mockResolvedValueOnce({ rows: [dlqEntry] })
        .mockResolvedValueOnce({ rows: [webhook] })
        .mockResolvedValueOnce({ rows: [] });

      mockedAxios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      app.use('/admin', createAdminRouter(mockPool as Pool));

      const res = await request(app)
        .post('/admin/webhooks/dlq/dlq-1/replay')
        .set('x-api-key', adminKey)
        .expect(500);

      expect(res.body.error.code).toBe('DLQ_REPLAY_FAILED');
    });
  });

  describe('POST /webhooks/dlq/bulk-replay - Bulk replay', () => {
    it('returns 401 without admin auth', async () => {
      app.use('/admin', createAdminRouter(mockPool as Pool));

      const res = await request(app)
        .post('/admin/webhooks/dlq/bulk-replay')
        .send({ ids: ['dlq-1'] })
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 503 when DATABASE_URL is unset', async () => {
      app.use('/admin', createAdminRouter(null));

      const res = await request(app)
        .post('/admin/webhooks/dlq/bulk-replay')
        .set('x-api-key', adminKey)
        .send({ ids: ['dlq-1'] })
        .expect(503);

      expect(res.body.error.code).toBe('DB_UNAVAILABLE');
    });

    it('rejects empty ids array', async () => {
      app.use('/admin', createAdminRouter(mockPool as Pool));

      const res = await request(app)
        .post('/admin/webhooks/dlq/bulk-replay')
        .set('x-api-key', adminKey)
        .send({ ids: [] })
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_IDS');
    });

    it('rejects non-array ids', async () => {
      app.use('/admin', createAdminRouter(mockPool as Pool));

      const res = await request(app)
        .post('/admin/webhooks/dlq/bulk-replay')
        .set('x-api-key', adminKey)
        .send({ ids: 'not-an-array' })
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_IDS');
    });

    it('rejects batch larger than 100', async () => {
      app.use('/admin', createAdminRouter(mockPool as Pool));

      const ids = Array.from({ length: 101 }, (_, i) => `dlq-${i}`);
      const res = await request(app)
        .post('/admin/webhooks/dlq/bulk-replay')
        .set('x-api-key', adminKey)
        .send({ ids })
        .expect(400);

      expect(res.body.error.code).toBe('BATCH_TOO_LARGE');
    });

    it('handles partial success and failure mix', async () => {
      const mockClient = {
        release: vi.fn(),
        query: vi.fn(),
      };

      (mockPool.connect as any).mockResolvedValueOnce(mockClient);
      (mockPool.query as any)
        .mockResolvedValueOnce({ rows: [{ id: 'dlq-1', webhook_id: 'wh-1', payload: { amount: 100 } }] })
        .mockResolvedValueOnce({ rows: [{ id: 'wh-1', url: 'https://example.com', secret: 'secret', active: true }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'dlq-2', webhook_id: 'wh-1', payload: { amount: 200 } }] })
        .mockResolvedValueOnce({ rows: [{ id: 'wh-1', url: 'https://example.com', secret: 'secret', active: true }] })
        .mockResolvedValueOnce({ rows: [] });

      mockedAxios.post
        .mockResolvedValueOnce({ status: 200 })
        .mockResolvedValueOnce({ status: 500 });

      app.use('/admin', createAdminRouter(mockPool as Pool));

      const res = await request(app)
        .post('/admin/webhooks/dlq/bulk-replay')
        .set('x-api-key', adminKey)
        .send({ ids: ['dlq-1', 'dlq-2'] })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.replayed).toContain('dlq-1');
      expect(res.body.data.failed).toHaveLength(1);
      expect(res.body.data.failed[0].id).toBe('dlq-2');
    });

    it('skips already-replayed entries without treating as error', async () => {
      (mockPool.query as any)
        .mockResolvedValueOnce({ rows: [{ id: 'dlq-1', webhook_id: 'wh-1', replayed_at: '2024-01-02T00:00:00Z' }] });

      app.use('/admin', createAdminRouter(mockPool as Pool));

      const res = await request(app)
        .post('/admin/webhooks/dlq/bulk-replay')
        .set('x-api-key', adminKey)
        .send({ ids: ['dlq-1'] })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.skipped).toContain('dlq-1');
      expect(res.body.data.failed).toHaveLength(0);
    });

    it('reports per-item outcomes rather than failing whole batch', async () => {
      const entries = [
        { id: 'dlq-1', webhook_id: 'wh-1', payload: { amount: 100 } },
        { id: 'dlq-missing' },
        { id: 'dlq-3', webhook_id: 'wh-1', payload: { amount: 300 } },
      ];

      (mockPool.query as any)
        .mockResolvedValueOnce({ rows: [entries[0]] })
        .mockResolvedValueOnce({ rows: [{ id: 'wh-1', url: 'https://example.com', secret: 'secret', active: true }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [entries[2]] })
        .mockResolvedValueOnce({ rows: [{ id: 'wh-1', url: 'https://example.com', secret: 'secret', active: true }] })
        .mockResolvedValueOnce({ rows: [] });

      mockedAxios.post
        .mockResolvedValueOnce({ status: 200 })
        .mockResolvedValueOnce({ status: 200 });

      app.use('/admin', createAdminRouter(mockPool as Pool));

      const res = await request(app)
        .post('/admin/webhooks/dlq/bulk-replay')
        .set('x-api-key', adminKey)
        .send({ ids: ['dlq-1', 'dlq-missing', 'dlq-3'] })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.replayed).toContain('dlq-1');
      expect(res.body.data.replayed).toContain('dlq-3');
      expect(res.body.data.skipped).toContain('dlq-missing');
      expect(res.body.data.failed).toHaveLength(0);
    });
  });
});
