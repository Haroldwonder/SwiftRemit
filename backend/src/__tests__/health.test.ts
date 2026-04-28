/**
 * Tests for /health endpoint DB probe (issue #432)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Hoisted mock state — controls whether the DB probe succeeds or fails
// ---------------------------------------------------------------------------
const { dbShouldFail, setDbFail } = vi.hoisted(() => {
  let dbShouldFail = false;
  return {
    dbShouldFail: { value: dbShouldFail },
    setDbFail: (v: boolean) => { dbShouldFail = v; (dbShouldFail as any); },
  };
});

// We need a mutable ref accessible inside the factory closure
const dbFailRef = { value: false };

vi.mock('../database', () => ({
  initDatabase: vi.fn().mockResolvedValue(undefined),
  getPool: vi.fn(() => ({
    query: vi.fn(async () => {
      if (dbFailRef.value) throw new Error('connection refused');
      return { rows: [{ '?column?': 1 }] };
    }),
    connect: vi.fn(),
    idleCount: 5,
    totalCount: 10,
  })),
  getAssetVerification: vi.fn().mockResolvedValue(null),
  saveAssetVerification: vi.fn().mockResolvedValue(undefined),
  reportSuspiciousAsset: vi.fn().mockResolvedValue(undefined),
  getVerifiedAssets: vi.fn().mockResolvedValue([]),
  saveFxRate: vi.fn().mockResolvedValue(undefined),
  getFxRate: vi.fn().mockResolvedValue(null),
  saveAnchorKycConfig: vi.fn().mockResolvedValue(undefined),
  getUserKycStatus: vi.fn().mockResolvedValue(null),
  saveUserKycStatus: vi.fn().mockResolvedValue(undefined),
  saveAssetReport: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../verifier', () => ({
  AssetVerifier: vi.fn().mockImplementation(() => ({
    verifyAsset: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('../stellar', () => ({
  storeVerificationOnChain: vi.fn().mockResolvedValue(undefined),
  simulateSettlement: vi.fn().mockResolvedValue({ would_succeed: true, payout_amount: '0', fee: '0', error_message: null }),
  cancelRemittanceOnChain: vi.fn().mockResolvedValue(undefined),
  updateKycStatusOnChain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../metrics', () => ({
  getMetricsService: vi.fn(() => ({
    getMetrics: vi.fn().mockResolvedValue(''),
    updateAllMetrics: vi.fn().mockResolvedValue(undefined),
    generatePrometheusText: vi.fn().mockReturnValue(''),
    incrementDeadLetterCount: vi.fn(),
  })),
}));

vi.mock('../sep24-service', () => ({
  Sep24Service: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
  Sep24ConfigError: class Sep24ConfigError extends Error {},
  Sep24AnchorError: class Sep24AnchorError extends Error {},
}));

vi.mock('../kyc-upsert-service', () => ({
  KycUpsertService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../transfer-guard', () => ({
  createTransferGuard: vi.fn(() => vi.fn((_req: any, _res: any, next: any) => next())),
}));

vi.mock('../fx-rate-cache', () => ({
  getFxRateCache: vi.fn(() => ({ get: vi.fn(), set: vi.fn() })),
}));

vi.mock('../correlation-id', () => ({
  correlationIdMiddleware: (_req: any, _res: any, next: any) => next(),
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Import app AFTER mocks are set up
const { default: app } = await import('../api');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GET /health', () => {
  beforeEach(() => {
    dbFailRef.value = false;
  });

  it('returns 200 with db:healthy when DB is reachable', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.db).toBe('healthy');
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  it('returns 503 with db:unhealthy when DB probe fails', async () => {
    dbFailRef.value = true;
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.db).toBe('unhealthy');
    expect(res.body.status).toBe('degraded');
  });
});
