import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import { Pool } from 'pg';
import {
  createAgentAnalyticsRouter,
  MAX_RANGE_DAYS_BY_INTERVAL,
} from '../routes/agent-analytics';

const ADMIN_KEY = 'test-admin-key-agent-analytics';

describe('Agent analytics maximum date range (Issue #1869)', () => {
  let app: Application;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = express();
    app.use(express.json());

    const mockPool = {
      query: async (sql: string) => {
        if (sql.includes('DATE_TRUNC')) return { rows: [] };
        return {
          rows: [
            {
              total_payouts: '0',
              total_earnings: '0',
              avg_confirmation_seconds: '0',
              success_count: '0',
              failure_count: '0',
            },
          ],
        };
      },
    } as unknown as Pool;

    app.use('/api/agents/:id/analytics', createAgentAnalyticsRouter(mockPool));
  });

  afterEach(() => {
    delete process.env.ADMIN_API_KEY;
  });

  const get = (query: string) =>
    request(app)
      .get(`/api/agents/agent-1/analytics${query}`)
      .set('x-api-key', ADMIN_KEY);

  it('exposes the per-interval limits', () => {
    expect(MAX_RANGE_DAYS_BY_INTERVAL).toEqual({
      hour: 7,
      day: 365,
      week: 1825,
      month: 1825,
    });
  });

  it('rejects hour interval ranges over 7 days', async () => {
    const res = await get('?from=2025-01-01T00:00:00Z&to=2025-01-09T00:00:00Z&interval=hour');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RANGE_TOO_LARGE');
    expect(res.body.error.message).toContain('7 days');
  });

  it('rejects day interval ranges over 1 year', async () => {
    const res = await get('?from=2020-01-01T00:00:00Z&to=2021-01-02T00:00:00Z&interval=day');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RANGE_TOO_LARGE');
    expect(res.body.error.message).toContain('365 days');
  });

  it('rejects week interval ranges over 5 years', async () => {
    const res = await get('?from=2015-01-01T00:00:00Z&to=2020-01-02T00:00:00Z&interval=week');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RANGE_TOO_LARGE');
  });

  it('rejects month interval ranges over 5 years', async () => {
    const res = await get('?from=2015-01-01T00:00:00Z&to=2020-01-02T00:00:00Z&interval=month');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RANGE_TOO_LARGE');
  });

  it('accepts ranges within the limit', async () => {
    const res = await get('?from=2025-01-01T00:00:00Z&to=2025-01-08T00:00:00Z&interval=hour');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('accepts hour interval as a valid interval', async () => {
    const res = await get('?from=2025-01-01T00:00:00Z&to=2025-01-02T00:00:00Z&interval=hour');
    expect(res.status).toBe(200);
    expect(res.body.data.interval).toBe('hour');
  });
});
