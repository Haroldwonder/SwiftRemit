/**
 * Audit-log streaming and load tests (Feature D)
 *
 * Verifies:
 *  - 1M-row export keeps backend RSS under documented ceiling (200 MB)
 *  - Requests without a date range are rejected with 400
 *  - The listing endpoint returns a cursor and honours it
 *  - Exceeding the row cap returns 413 with guidance
 *  - The server-side PG cursor streams rows rather than buffering them
 *  - Cursor pagination returns consistent pages across multiple calls
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// ---------------------------------------------------------------------------
// Row-budget constant (must match what's in schemas/zod.ts)
// ---------------------------------------------------------------------------
const EXPORT_ROW_CAP  = 100_000;
const MAX_DAYS        = 90;
const RSS_CEILING_MB  = 200; // documented memory ceiling for 1M-row export

// ---------------------------------------------------------------------------
// Mocks — heavy dependencies
// ---------------------------------------------------------------------------
let auditLogLogSpy = vi.fn();

vi.mock('../database', () => ({
  getPool: vi.fn(() => mockPool),
  saveContractEvent: vi.fn(),
  queryContractEvents: vi.fn().mockResolvedValue({ events: [], total: 0 }),
  getWebhookSubscriberById: vi.fn(),
  rotateWebhookSecret: vi.fn(),
  getActiveWebhookSubscribers: vi.fn().mockResolvedValue([]),
  enqueueWebhookDelivery: vi.fn(),
  markWebhookDeliverySuccess: vi.fn(),
  markWebhookDeliveryFailure: vi.fn(),
  getPendingWebhookDeliveries: vi.fn().mockResolvedValue([]),
  initDatabase: vi.fn(),
}));
vi.mock('../stellar', () => ({
  storeVerificationOnChain: vi.fn(),
  simulateSettlement: vi.fn(),
  cancelRemittanceOnChain: vi.fn(),
  updateKycStatusOnChain: vi.fn(),
}));
vi.mock('../metrics', () => ({
  getMetricsService: vi.fn(() => ({
    getMetrics: vi.fn().mockResolvedValue(''),
    setFxRateStalenessMetric: vi.fn(),
    incrementRateLimitExceeded: vi.fn(),
  })),
}));
vi.mock('../fx-rate-cache', () => ({
  getFxRateCache: vi.fn(() => ({ getCurrentRate: vi.fn(), setMetricsObserver: vi.fn() })),
}));
vi.mock('../kyc-upsert-service', () => ({
  KycUpsertService: vi.fn().mockImplementation(() => ({ getStatusForUser: vi.fn() })),
}));
vi.mock('../transfer-guard', () => ({
  createTransferGuard: vi.fn(() => vi.fn((_: any, __: any, next: any) => next())),
}));
vi.mock('../agent-kyc-service', () => ({ AgentKycService: vi.fn() }));
vi.mock('../correlation-id', () => ({
  correlationIdMiddleware: vi.fn((_: any, __: any, next: any) => next()),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));
vi.mock('../sanitizer', () => ({ sanitizeInput: vi.fn((v: string) => v) }));
vi.mock('../sep24-service', () => ({
  Sep24Service: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(), initiateFlow: vi.fn(),
    getTransactionStatus: vi.fn(), pollAllTransactions: vi.fn(),
  })),
  Sep24ConfigError: class Sep24ConfigError extends Error {},
  Sep24AnchorError:  class Sep24AnchorError  extends Error { statusCode?: number; },
}));
vi.mock('../admin-audit-log', () => ({
  AdminAuditLogService: vi.fn().mockImplementation(() => ({
    log:   auditLogLogSpy,
    query: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
  })),
}));
vi.mock('../job-tracker', () => ({ getJobSummaries: vi.fn().mockResolvedValue([]) }));
vi.mock('../remittance/events', () => ({ remittanceEventEmitter: { onStatusChange: vi.fn() } }));
vi.mock('../kyc-webhook-handler', () => ({ handleKycWebhook: vi.fn() }));
vi.mock('../middleware/api-key-rate-limit', () => ({
  apiKeyRateLimiter: vi.fn((_: any, __: any, next: any) => next()),
}));
vi.mock('../routes/docs', () => ({
  default: express.Router(),
}));
vi.mock('../routes/compliance', () => ({
  createComplianceRouter: vi.fn(() => express.Router()),
  autoFlagIfAboveThreshold: vi.fn(),
}));
vi.mock('../verifier', () => ({
  AssetVerifier: vi.fn().mockImplementation(() => ({ verifyAsset: vi.fn() })),
}));
vi.mock('../stellar-network', () => ({
  getStellarRuntimeConfig: vi.fn(() => ({
    rpcUrl: 'http://localhost', networkPassphrase: 'Test',
  })),
}));

process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';

// ---------------------------------------------------------------------------
// Configurable mock pool (mutated per-test)
// ---------------------------------------------------------------------------

/** Rows returned by SELECT COUNT(*) — controls the row-cap check. */
let mockCountRows = [{ count: '0' }];

/** Rows returned by FETCH from cursor — drives the streaming path. */
let cursorBatchRows: Record<string, unknown>[][] = [];
let cursorBatchIndex = 0;

/** Rows returned by the listing endpoint query. */
let listingRows: Record<string, unknown>[] = [];

const mockClientRelease = vi.fn();
const mockClient = {
  query: vi.fn().mockImplementation(async (sql: string) => {
    if (/^BEGIN/i.test(sql))   return { rows: [] };
    if (/^COMMIT/i.test(sql))  return { rows: [] };
    if (/^ROLLBACK/i.test(sql))return { rows: [] };
    if (/^DECLARE/i.test(sql)) { cursorBatchIndex = 0; return { rows: [] }; }
    if (/^CLOSE/i.test(sql))   return { rows: [] };
    if (/^FETCH/i.test(sql)) {
      const batch = cursorBatchRows[cursorBatchIndex++] ?? [];
      return { rows: batch, rowCount: batch.length };
    }
    return { rows: [], rowCount: 0 };
  }),
  release: mockClientRelease,
};

const mockPool = {
  query: vi.fn().mockImplementation(async (sql: string, _params?: unknown[]) => {
    // COUNT query for row-cap check
    if (/select count\(\*\) from admin_audit_log/i.test(sql)) {
      return { rows: mockCountRows, rowCount: 1 };
    }
    // Listing query (no cursor)
    if (/select \* from admin_audit_log/i.test(sql)) {
      return { rows: listingRows, rowCount: listingRows.length };
    }
    return { rows: [], rowCount: 0 };
  }),
  connect: vi.fn().mockResolvedValue(mockClient),
  totalCount: 0, idleCount: 0, waitingCount: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function iso(date: Date): string {
  return date.toISOString();
}

function rangeParams(
  daysAgo: number,
  daysAhead: number = 0
): { from: string; to: string } {
  const from = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
  const to   = new Date(Date.now() + daysAhead * 24 * 3600 * 1000);
  return { from: iso(from), to: iso(to) };
}

function makeAuditRow(id: number): Record<string, unknown> {
  return {
    id,
    admin_address: 'admin@test.com',
    action:        'test_action',
    target:        'some-resource',
    params_json:   null,
    tx_hash:       null,
    ip_address:    '127.0.0.1',
    created_at:    new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Audit-log export streaming and load (Feature D)', () => {
  let app: any;

  beforeEach(async () => {
    // Reset pool mocks between tests
    mockCountRows     = [{ count: '0' }];
    cursorBatchRows   = [];
    cursorBatchIndex  = 0;
    listingRows       = [];
    auditLogLogSpy = vi.fn();
    mockClient.query.mockClear();
    mockPool.query.mockClear();
    mockPool.connect.mockClear();
    vi.clearAllMocks();

    // Re-import fresh app for each test group
    const mod = await import('../api');
    app = mod.default;
  });

  // ── Missing date range ────────────────────────────────────────────────

  it('rejects export without date range (400)', async () => {
    const res = await request(app).get('/api/admin/audit-log/export');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid query parameters');
  });

  it('rejects export with only "from" (400)', async () => {
    const res = await request(app).get(
      `/api/admin/audit-log/export?from=${encodeURIComponent(new Date().toISOString())}`
    );
    expect(res.status).toBe(400);
  });

  it('rejects export with only "to" (400)', async () => {
    const res = await request(app).get(
      `/api/admin/audit-log/export?to=${encodeURIComponent(new Date().toISOString())}`
    );
    expect(res.status).toBe(400);
  });

  it('rejects export with date range exceeding 90 days (400)', async () => {
    const { from, to } = rangeParams(100);
    const res = await request(app).get(
      `/api/admin/audit-log/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    expect(res.status).toBe(400);
    expect(res.body.details?.[0]?.message).toMatch(/90 days/i);
  });

  it('accepts export with valid date range ≤ 90 days', async () => {
    const { from, to } = rangeParams(7);
    mockCountRows = [{ count: '0' }];
    cursorBatchRows = [[]]; // empty result

    const res = await request(app).get(
      `/api/admin/audit-log/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/ndjson/);
  });

  // ── Row cap (413) ─────────────────────────────────────────────────────

  it('returns 413 when row count exceeds cap', async () => {
    const { from, to } = rangeParams(7);
    mockCountRows = [{ count: String(EXPORT_ROW_CAP + 1) }];

    const res = await request(app).get(
      `/api/admin/audit-log/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    expect(res.status).toBe(413);
    expect(res.body.cap).toBe(EXPORT_ROW_CAP);
    expect(res.body.matched).toBe(EXPORT_ROW_CAP + 1);
    expect(res.body.error).toMatch(/row cap/i);
    expect(res.body.max_date_range_days).toBe(MAX_DAYS);
  });

  it('returns 200 when row count equals exactly the cap', async () => {
    const { from, to } = rangeParams(7);
    mockCountRows  = [{ count: String(EXPORT_ROW_CAP) }];
    cursorBatchRows = [[]]; // empty batches

    const res = await request(app).get(
      `/api/admin/audit-log/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    expect(res.status).toBe(200);
  });

  // ── Streaming (server-side cursor) ─────────────────────────────────────

  it('streams rows as NDJSON without buffering full result set', async () => {
    const { from, to } = rangeParams(7);
    const rows = Array.from({ length: 10 }, (_, i) => makeAuditRow(i + 1));

    mockCountRows   = [{ count: '10' }];
    cursorBatchRows = [rows.slice(0, 5), rows.slice(5), []];

    const res = await request(app).get(
      `/api/admin/audit-log/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/ndjson/);

    // Parse each newline-delimited JSON line
    const lines = (res.text as string)
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    expect(lines).toHaveLength(10);
    expect(lines[0].id).toBe(1);
    expect(lines[9].id).toBe(10);
  });

  it('X-Total-Rows header reflects matched row count', async () => {
    const { from, to } = rangeParams(7);
    mockCountRows   = [{ count: '42' }];
    cursorBatchRows = [[]];

    const res = await request(app).get(
      `/api/admin/audit-log/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    expect(res.headers['x-total-rows']).toBe('42');
  });

  it('uses DECLARE CURSOR and FETCH — never loads full result set in memory', async () => {
    const { from, to } = rangeParams(7);
    mockCountRows   = [{ count: '5' }];
    cursorBatchRows = [[makeAuditRow(1)], []];

    await request(app).get(
      `/api/admin/audit-log/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );

    const clientCalls = mockClient.query.mock.calls.map((call: any[]) =>
      (call[0] as string).toUpperCase().slice(0, 10).trim()
    );
    expect(clientCalls).toContain('BEGIN');
    expect(clientCalls).toContain('DECLARE');
    expect(clientCalls).toContain('FETCH 500 FR');  // first 10 chars of FETCH 500 FROM
    expect(clientCalls).toContain('CLOSE');
    expect(clientCalls).toContain('COMMIT');
  });

  // ── 1M-row RSS test ────────────────────────────────────────────────────
  // We simulate 1 000 000 rows by returning batches from the mock cursor.
  // The test measures RSS before and after and asserts < 200 MB growth.

  it(`exporting 1M rows keeps RSS growth under ${RSS_CEILING_MB} MB`, async () => {
    const TOTAL_ROWS  = 1_000_000;
    const BATCH_SIZE  = 500;
    const BATCH_COUNT = TOTAL_ROWS / BATCH_SIZE;

    // Build batch array of BATCH_COUNT full batches + one empty terminator
    const singleBatch = Array.from({ length: BATCH_SIZE }, (_, i) => makeAuditRow(i));
    // Use a generator via mockImplementation to avoid holding all 1M rows in JS memory
    let fetchCallCount = 0;
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/^BEGIN/i.test(sql))    return { rows: [] };
      if (/^COMMIT/i.test(sql))   return { rows: [] };
      if (/^ROLLBACK/i.test(sql)) return { rows: [] };
      if (/^DECLARE/i.test(sql))  { fetchCallCount = 0; return { rows: [] }; }
      if (/^CLOSE/i.test(sql))    return { rows: [] };
      if (/^FETCH/i.test(sql)) {
        fetchCallCount++;
        if (fetchCallCount <= BATCH_COUNT) {
          return { rows: singleBatch, rowCount: BATCH_SIZE };
        }
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const { from, to } = rangeParams(7);
    mockPool.query.mockImplementation(async (sql: string) => {
      if (/select count\(\*\) from admin_audit_log/i.test(sql)) {
        return { rows: [{ count: String(TOTAL_ROWS) }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    // Allow 1M rows (temporarily override cap in test by seeding count = TOTAL_ROWS = cap)
    // We need count ≤ EXPORT_ROW_CAP for the endpoint to proceed;
    // simulate exactly at cap for this test.
    const testTotal = EXPORT_ROW_CAP; // use cap as "1M" proxy for RSS measurement
    mockPool.query.mockImplementation(async (sql: string) => {
      if (/select count\(\*\) from admin_audit_log/i.test(sql)) {
        return { rows: [{ count: String(testTotal) }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    // Measure RSS before
    const rssBefore = process.memoryUsage().rss;

    const res = await request(app).get(
      `/api/admin/audit-log/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );

    const rssAfter = process.memoryUsage().rss;
    const growthMB = (rssAfter - rssBefore) / (1024 * 1024);

    expect(res.status).toBe(200);
    expect(growthMB).toBeLessThan(RSS_CEILING_MB);

    // Log for CI visibility
    console.log(
      `[RSS] before=${(rssBefore / 1024 / 1024).toFixed(1)} MB  ` +
      `after=${(rssAfter / 1024 / 1024).toFixed(1)} MB  ` +
      `growth=${growthMB.toFixed(1)} MB  ceiling=${RSS_CEILING_MB} MB`
    );
  }, 60_000); // generous timeout for large export

  it('logs admin actions for webhook listing and audit export routes', async () => {
    mockPool.query.mockImplementation(async (sql: string) => {
      if (/select id, url, secret, previous_secret, secret_rotated_at, active, created_at, updated_at/i.test(sql)) {
        return { rows: [{ id: 1, url: 'https://example.com', secret: 'secret', previous_secret: null, secret_rotated_at: null, active: true, created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
      }
      if (/select count\(\*\) from admin_audit_log/i.test(sql)) {
        return { rows: [{ count: '0' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const webhooksRes = await request(app).get('/api/webhooks');
    expect(webhooksRes.status).toBe(200);
    expect(auditLogLogSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'list_webhooks',
      admin_address: 'unknown',
    }));

    const { from, to } = rangeParams(7);
    mockCountRows = [{ count: '0' }];
    cursorBatchRows = [[]];

    const exportRes = await request(app).get(
      `/api/admin/audit-log/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );

    expect(exportRes.status).toBe(200);
    expect(auditLogLogSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'export_admin_audit_log',
      admin_address: 'unknown',
    }));
  });

  // ── Listing cursor pagination ──────────────────────────────────────────

  it('listing endpoint returns next_cursor when more rows exist', async () => {
    // Return limit+1 rows so endpoint knows there is a next page
    const rows = Array.from({ length: 51 }, (_, i) =>
      makeAuditRow(i + 1)
    );
    listingRows = rows;

    const res = await request(app).get('/api/admin/audit-log?limit=50');
    expect(res.status).toBe(200);
    expect(res.body.next_cursor).toBeTruthy();
    expect(typeof res.body.next_cursor).toBe('string');
    expect(res.body.entries).toHaveLength(50);
  });

  it('listing endpoint next_cursor is null when no more rows', async () => {
    listingRows = Array.from({ length: 10 }, (_, i) => makeAuditRow(i + 1));

    const res = await request(app).get('/api/admin/audit-log?limit=50');
    expect(res.status).toBe(200);
    expect(res.body.next_cursor).toBeNull();
    expect(res.body.entries).toHaveLength(10);
  });

  it('listing endpoint honours cursor parameter', async () => {
    // Build a valid cursor from a fake last row
    const lastRow   = makeAuditRow(100);
    const cursor    = Buffer.from(
      JSON.stringify({ id: 100, created_at: lastRow.created_at })
    ).toString('base64');

    listingRows = [makeAuditRow(101), makeAuditRow(102)];

    const res = await request(app).get(
      `/api/admin/audit-log?limit=50&cursor=${encodeURIComponent(cursor)}`
    );
    expect(res.status).toBe(200);
    expect(res.body.cursor).toBe(cursor);
    expect(res.body.entries).toHaveLength(2);
  });

  it('listing endpoint rejects malformed cursor with 400', async () => {
    const res = await request(app).get(
      `/api/admin/audit-log?cursor=${encodeURIComponent('not-valid-base64-json!!!')}`
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid cursor');
  });

  it('listing endpoint returns correct shape', async () => {
    listingRows = [makeAuditRow(1)];

    const res = await request(app).get('/api/admin/audit-log');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      limit:       expect.any(Number),
      cursor:      null,
      next_cursor: null,
      entries:     expect.any(Array),
    });
  });
});
