/**
 * Tests for the admin remittances CSV export stream error handling.
 * Issue #1866
 *
 * Covers: mid-stream generator failure (socket destroyed, no silent truncated
 * 200) and pre-stream failure (500 JSON with correlation ID).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import express, { Express } from 'express';
import { createAdminRouter } from '../routes/admin';

const adminKey = 'test-admin-key-12345';

function makePool(connect: () => Promise<unknown>): Pool {
  return { query: vi.fn(), connect: vi.fn(connect) } as unknown as Pool;
}

let app: Express;

beforeEach(() => {
  process.env.ADMIN_API_KEY = adminKey;
  app = express();
  app.use(express.json());
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_API_KEY;
});

describe('GET /admin/remittances/export - stream failures', () => {
  it('destroys the socket when the generator throws mid-stream', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = {
      query: vi
        .fn()
        // BEGIN
        .mockResolvedValueOnce({})
        // DECLARE CURSOR
        .mockResolvedValueOnce({})
        // FETCH FORWARD -> one row, then the next fetch throws
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'r1',
              sender: 's',
              recipient: 'r',
              agent: 'a',
              amount: 1,
              fee: 0,
              currency: 'USD',
              status: 'Completed',
              corridor: 'US-MX',
              created_at: '2026-01-01',
              updated_at: '2026-01-01',
              memo: null,
            },
          ],
        })
        .mockRejectedValueOnce(new Error('cursor exploded'))
        .mockResolvedValue({}),
      release: vi.fn(),
    };

    app.use('/admin', createAdminRouter(makePool(async () => client)));

    const res = await request(app)
      .get('/admin/remittances/export')
      .set('x-api-key', adminKey);

    // The response must not look like a clean, complete 200 download.
    expect(res.status).not.toBe(200);
    expect(errorSpy).toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('returns a 500 JSON error with a correlation ID when nothing was written', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('DECLARE failed')),
      release: vi.fn(),
    };

    app.use('/admin', createAdminRouter(makePool(async () => client)));

    const res = await request(app)
      .get('/admin/remittances/export')
      .set('x-api-key', adminKey);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('CSV_EXPORT_FAILED');
    expect(typeof res.body.error.correlation_id).toBe('string');
    expect(res.body.error.correlation_id.length).toBeGreaterThan(0);
    expect(errorSpy).toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });
});
