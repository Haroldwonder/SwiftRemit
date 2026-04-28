/**
 * Tests for the optional memo field on remittance creation.
 *
 * Covers:
 * - Remittance with memo saves and returns correctly
 * - Remittance without memo works as before (backward compat)
 * - Memo exceeding 100 chars is rejected with 400
 * - Memo is sanitized before storage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ── mock pool ──────────────────────────────────────────────────────────────
const { mockPool, insertedRows } = vi.hoisted(() => {
  const insertedRows: any[] = [];

  const mockPool = {
    query: vi.fn(async (sql: string, params: any[]) => {
      const s = sql.toUpperCase();
      if (s.includes('INSERT INTO TRANSACTIONS')) {
        const row = {
          transaction_id: params[0],
          anchor_id: params[1],
          amount_in: params[2],
          memo: params[3],
          status: 'pending_user_transfer_start',
          created_at: new Date().toISOString(),
        };
        insertedRows.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (s.includes('SELECT') && s.includes('FROM TRANSACTIONS')) {
        const found = insertedRows.find((r) => r.transaction_id === params[0]);
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };

  return { mockPool, insertedRows };
});

vi.mock('../database', () => ({
  getPool: () => mockPool,
  getAssetVerification: vi.fn(),
  saveAssetVerification: vi.fn(),
  reportSuspiciousAsset: vi.fn(),
  getVerifiedAssets: vi.fn(),
  saveFxRate: vi.fn(),
  getFxRate: vi.fn(),
  saveAnchorKycConfig: vi.fn(),
  getUserKycStatus: vi.fn(),
  saveUserKycStatus: vi.fn(),
  saveAssetReport: vi.fn(),
  getActiveWebhookSubscribers: vi.fn().mockResolvedValue([]),
  getPendingWebhookDeliveries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../stellar', () => ({
  storeVerificationOnChain: vi.fn(),
  simulateSettlement: vi.fn(),
}));

vi.mock('../metrics', () => ({
  getMetricsService: () => ({ getMetrics: vi.fn().mockResolvedValue('') }),
}));

vi.mock('../fx-rate-cache', () => ({
  getFxRateCache: () => ({ getCurrentRate: vi.fn() }),
}));

vi.mock('../kyc-upsert-service', () => ({
  KycUpsertService: vi.fn().mockImplementation(() => ({
    getStatusForUser: vi.fn(),
  })),
}));

vi.mock('../transfer-guard', () => ({
  createTransferGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../sep24-service', () => ({
  Sep24Service: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    initiateFlow: vi.fn(),
    getTransactionStatus: vi.fn(),
  })),
  Sep24ConfigError: class Sep24ConfigError extends Error {},
  Sep24AnchorError: class Sep24AnchorError extends Error {},
}));

import app from '../api';

const AUTH_HEADER = { 'x-user-id': 'user-test-1' };

const BASE_BODY = {
  sender: 'GSENDERADDRESS000000000000000000000000000000000000000000',
  agent: 'anchor-test',
  amount: '100.00',
};

beforeEach(() => {
  insertedRows.length = 0;
  vi.clearAllMocks();
});

describe('POST /api/remittance — memo field', () => {
  it('creates remittance with memo and returns it in the response', async () => {
    const res = await request(app)
      .post('/api/remittance')
      .set(AUTH_HEADER)
      .send({ ...BASE_BODY, memo: 'Invoice #1234' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.remittance.memo).toBe('Invoice #1234');
  });

  it('creates remittance without memo (backward compat)', async () => {
    const res = await request(app)
      .post('/api/remittance')
      .set(AUTH_HEADER)
      .send(BASE_BODY);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.remittance.memo).toBeNull();
  });

  it('creates remittance with empty memo string (treated as no memo)', async () => {
    const res = await request(app)
      .post('/api/remittance')
      .set(AUTH_HEADER)
      .send({ ...BASE_BODY, memo: '' });

    expect(res.status).toBe(201);
    expect(res.body.remittance.memo).toBeNull();
  });

  it('rejects memo exceeding 100 characters with 400', async () => {
    const longMemo = 'A'.repeat(101);
    const res = await request(app)
      .post('/api/remittance')
      .set(AUTH_HEADER)
      .send({ ...BASE_BODY, memo: longMemo });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/100/);
  });

  it('accepts memo of exactly 100 characters', async () => {
    const exactMemo = 'B'.repeat(100);
    const res = await request(app)
      .post('/api/remittance')
      .set(AUTH_HEADER)
      .send({ ...BASE_BODY, memo: exactMemo });

    expect(res.status).toBe(201);
    expect(res.body.remittance.memo).toBe(exactMemo);
  });

  it('sanitizes memo before storage (strips HTML tags)', async () => {
    const res = await request(app)
      .post('/api/remittance')
      .set(AUTH_HEADER)
      .send({ ...BASE_BODY, memo: '<script>alert(1)</script>Invoice #99' });

    expect(res.status).toBe(201);
    expect(res.body.remittance.memo).not.toContain('<script>');
    expect(res.body.remittance.memo).toContain('Invoice #99');
  });
});

describe('GET /api/remittance/:id — memo field', () => {
  it('returns memo on the remittance detail response', async () => {
    // Create first
    const createRes = await request(app)
      .post('/api/remittance')
      .set(AUTH_HEADER)
      .send({ ...BASE_BODY, memo: 'REF-2024-001' });

    const { remittance_id } = createRes.body.remittance;

    const getRes = await request(app).get(`/api/remittance/${remittance_id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.memo).toBe('REF-2024-001');
  });

  it('returns null memo when none was set', async () => {
    const createRes = await request(app)
      .post('/api/remittance')
      .set(AUTH_HEADER)
      .send(BASE_BODY);

    const { remittance_id } = createRes.body.remittance;

    const getRes = await request(app).get(`/api/remittance/${remittance_id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.memo).toBeNull();
  });
});
