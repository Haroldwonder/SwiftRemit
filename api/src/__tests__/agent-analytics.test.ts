/**
 * Unit tests for GET /api/agents/:id/analytics (Issue #947)
 *
 * Uses supertest + express in-process.  The DB pool is mocked so no real
 * Postgres connection is required.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import { createHash } from 'crypto';
import { createAgentsRouter } from '../routes/agents';
import type { Pool } from 'pg';

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_AGENT_ID = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
const ADMIN_KEY       = 'test-admin-key-947';
const HMAC_SECRET     = 'test-hmac-secret-947';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build the three required HMAC proof headers for agent auth.
 * Mirrors the logic in AgentAnalytics.tsx.
 */
function buildAgentHeaders(
  agentId: string,
  secret: string,
  tsOverride?: string,
): Record<string, string> {
  const ts  = tsOverride ?? new Date().toISOString();
  const msg = `${agentId}|${ts}|${secret}`;
  const sig = createHash('sha256').update(msg).digest('hex');
  return {
    'x-agent-id':        agentId,
    'x-agent-timestamp': ts,
    'x-agent-signature': sig,
  };
}

/**
 * Build a minimal mock Pool that returns configurable analytics rows.
 */
function buildMockPool(overrides?: {
  summaryRow?: Record<string, string | null>;
  tsRows?: Record<string, string | null>[];
  shouldThrow?: boolean;
}): Pool {
  const defaultSummary = {
    total_payouts:           '42',
    total_earnings_usdc:     '3850.50',
    avg_confirmation_time_s: '127.4',
    reputation_score:        null,
  };
  const defaultTs = [
    {
      bucket:                  new Date('2026-07-01').toISOString(),
      payouts:                 '10',
      earnings_usdc:           '900.00',
      avg_confirmation_time_s: '120.0',
    },
    {
      bucket:                  new Date('2026-07-08').toISOString(),
      payouts:                 '15',
      earnings_usdc:           '1350.00',
      avg_confirmation_time_s: '130.0',
    },
  ];

  let callCount = 0;
  return {
    query: async () => {
      if (overrides?.shouldThrow) throw new Error('DB error');

      callCount++;
      if (callCount === 1) {
        // First call → summary
        return { rows: [{ ...defaultSummary, ...(overrides?.summaryRow ?? {}) }] };
      }
      // Second call → time-series
      return { rows: overrides?.tsRows ?? defaultTs };
    },
  } as unknown as Pool;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /api/agents/:id/analytics (Issue #947)', () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    process.env.ADMIN_API_KEY   = ADMIN_KEY;
    process.env.AGENT_HMAC_SECRET = HMAC_SECRET;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Auth ─────────────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 401 with no auth headers', async () => {
      const router = createAgentsRouter(buildMockPool());
      app.use('/api/agents', router);

      const res = await request(app).get(`/api/agents/${VALID_AGENT_ID}/analytics`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 200 with valid admin key', async () => {
      const router = createAgentsRouter(buildMockPool());
      app.use('/api/agents', router);

      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 200 with valid agent HMAC proof', async () => {
      const router = createAgentsRouter(buildMockPool());
      app.use('/api/agents', router);

      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set(buildAgentHeaders(VALID_AGENT_ID, HMAC_SECRET));
      expect(res.status).toBe(200);
    });

    it('returns 401 with wrong admin key', async () => {
      const router = createAgentsRouter(buildMockPool());
      app.use('/api/agents', router);

      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', 'wrong-key');
      expect(res.status).toBe(401);
    });

    it('returns 401 when agent id in header does not match :id param', async () => {
      const router = createAgentsRouter(buildMockPool());
      app.use('/api/agents', router);

      const differentId = 'GBVNNPOFVV2YNXSQXDJPBVNUAEDBBZV7YOYPNRHMCJVLQOLHQGVMKHB2';
      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set(buildAgentHeaders(differentId, HMAC_SECRET));  // signed for different id
      expect(res.status).toBe(401);
    });

    it('returns 401 when signature is for a stale timestamp (>5 min ago)', async () => {
      const router = createAgentsRouter(buildMockPool());
      app.use('/api/agents', router);

      const staleTs = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set(buildAgentHeaders(VALID_AGENT_ID, HMAC_SECRET, staleTs));
      expect(res.status).toBe(401);
    });

    it('returns 401 when AGENT_HMAC_SECRET env var is not set', async () => {
      delete process.env.AGENT_HMAC_SECRET;
      const router = createAgentsRouter(buildMockPool());
      app.use('/api/agents', router);

      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set(buildAgentHeaders(VALID_AGENT_ID, HMAC_SECRET));
      expect(res.status).toBe(401);

      // Restore for subsequent tests
      process.env.AGENT_HMAC_SECRET = HMAC_SECRET;
    });
  });

  // ─── Input validation ─────────────────────────────────────────────────────

  describe('input validation', () => {
    beforeEach(() => {
      const router = createAgentsRouter(buildMockPool());
      app.use('/api/agents', router);
    });

    it('returns 400 for invalid agent id (not a Stellar key)', async () => {
      const res = await request(app)
        .get('/api/agents/not-a-stellar-key/analytics')
        .set('x-api-key', ADMIN_KEY);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ADDRESS');
    });

    it('returns 400 for an invalid range', async () => {
      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics?range=365d`)
        .set('x-api-key', ADMIN_KEY);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_RANGE');
    });

    it('returns 400 for an invalid granularity', async () => {
      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics?granularity=hour`)
        .set('x-api-key', ADMIN_KEY);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GRANULARITY');
    });

    it('accepts all valid ranges', async () => {
      for (const range of ['7d', '30d', '90d']) {
        const res = await request(app)
          .get(`/api/agents/${VALID_AGENT_ID}/analytics?range=${range}`)
          .set('x-api-key', ADMIN_KEY);
        expect(res.status).toBe(200);
        expect(res.body.data.summary.range).toBe(range);
      }
    });

    it('accepts all valid granularities', async () => {
      for (const granularity of ['day', 'week', 'month']) {
        const res = await request(app)
          .get(`/api/agents/${VALID_AGENT_ID}/analytics?granularity=${granularity}`)
          .set('x-api-key', ADMIN_KEY);
        expect(res.status).toBe(200);
        expect(res.body.data.granularity).toBe(granularity);
      }
    });
  });

  // ─── Response shape ───────────────────────────────────────────────────────

  describe('response shape', () => {
    beforeEach(() => {
      const router = createAgentsRouter(buildMockPool());
      app.use('/api/agents', router);
    });

    it('returns summary with expected fields', async () => {
      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      expect(res.status).toBe(200);
      const { summary } = res.body.data as {
        summary: Record<string, unknown>;
        time_series: unknown[];
        granularity: string;
      };
      expect(summary.agent_id).toBe(VALID_AGENT_ID);
      expect(summary.range).toBe('30d');
      expect(typeof summary.total_payouts).toBe('number');
      expect(typeof summary.total_earnings_usdc).toBe('number');
    });

    it('parses total_payouts as a number', async () => {
      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      expect(res.body.data.summary.total_payouts).toBe(42);
    });

    it('parses total_earnings_usdc as a float', async () => {
      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      expect(res.body.data.summary.total_earnings_usdc).toBeCloseTo(3850.5);
    });

    it('parses avg_confirmation_time_s as a rounded integer', async () => {
      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      // 127.4 rounds to 127
      expect(res.body.data.summary.avg_confirmation_time_s).toBe(127);
    });

    it('returns reputation_score as null when DB has no score', async () => {
      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      expect(res.body.data.summary.reputation_score).toBeNull();
    });

    it('includes time_series array with correct shape', async () => {
      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      const ts = res.body.data.time_series as Array<Record<string, unknown>>;
      expect(Array.isArray(ts)).toBe(true);
      expect(ts.length).toBe(2);

      const point = ts[0];
      expect(typeof point.bucket).toBe('string');
      expect(typeof point.payouts).toBe('number');
      expect(typeof point.earnings_usdc).toBe('number');
    });

    it('time_series bucket is a valid ISO string', async () => {
      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      const ts = res.body.data.time_series as Array<{ bucket: string }>;
      expect(() => new Date(ts[0].bucket)).not.toThrow();
      expect(isNaN(new Date(ts[0].bucket).getTime())).toBe(false);
    });

    it('includes a top-level timestamp field', async () => {
      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      expect(typeof res.body.timestamp).toBe('string');
    });
  });

  // ─── No-pool fallback ─────────────────────────────────────────────────────

  describe('no-pool fallback (non-DB environment)', () => {
    it('returns empty analytics when pool is undefined', async () => {
      const router = createAgentsRouter(/* no pool */);
      app.use('/api/agents', router);

      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      expect(res.status).toBe(200);
      expect(res.body.data.summary.total_payouts).toBe(0);
      expect(res.body.data.time_series).toEqual([]);
    });
  });

  // ─── DB error handling ────────────────────────────────────────────────────

  describe('database error handling', () => {
    it('returns 500 when the pool query throws', async () => {
      const router = createAgentsRouter(buildMockPool({ shouldThrow: true }));
      app.use('/api/agents', router);

      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('ANALYTICS_ERROR');
    });
  });

  // ─── Query param defaults ─────────────────────────────────────────────────

  describe('query parameter defaults', () => {
    it('defaults range to 30d', async () => {
      const router = createAgentsRouter(buildMockPool());
      app.use('/api/agents', router);

      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      expect(res.body.data.summary.range).toBe('30d');
    });

    it('defaults granularity to day', async () => {
      const router = createAgentsRouter(buildMockPool());
      app.use('/api/agents', router);

      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      expect(res.body.data.granularity).toBe('day');
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles zero payouts gracefully', async () => {
      const router = createAgentsRouter(
        buildMockPool({
          summaryRow: {
            total_payouts:           '0',
            total_earnings_usdc:     '0',
            avg_confirmation_time_s: null,
            reputation_score:        null,
          },
          tsRows: [],
        }),
      );
      app.use('/api/agents', router);

      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      expect(res.status).toBe(200);
      expect(res.body.data.summary.total_payouts).toBe(0);
      expect(res.body.data.summary.avg_confirmation_time_s).toBeNull();
      expect(res.body.data.time_series).toHaveLength(0);
    });

    it('handles a non-null reputation_score', async () => {
      const router = createAgentsRouter(
        buildMockPool({
          summaryRow: {
            total_payouts:           '5',
            total_earnings_usdc:     '500',
            avg_confirmation_time_s: '60',
            reputation_score:        '87',
          },
        }),
      );
      app.use('/api/agents', router);

      const res = await request(app)
        .get(`/api/agents/${VALID_AGENT_ID}/analytics`)
        .set('x-api-key', ADMIN_KEY);

      expect(res.body.data.summary.reputation_score).toBe(87);
    });
  });
});
