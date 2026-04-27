import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Minimal mocks so app can be imported without real DB/Stellar
vi.mock('../database', () => ({
  initDatabase: vi.fn().mockResolvedValue(undefined),
  getPool: vi.fn(() => ({ query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() })),
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
  AssetVerifier: vi.fn().mockImplementation(() => ({ verifyAsset: vi.fn() })),
}));
vi.mock('../stellar', () => ({
  storeVerificationOnChain: vi.fn().mockResolvedValue(undefined),
  simulateSettlement: vi.fn().mockResolvedValue({}),
}));
vi.mock('../sep24-service', () => ({
  Sep24Service: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    initiateFlow: vi.fn(),
    getTransactionStatus: vi.fn(),
  })),
  Sep24ConfigError: class extends Error {},
  Sep24AnchorError: class extends Error { statusCode = 502; },
}));
vi.mock('../kyc-upsert-service', () => ({
  KycUpsertService: vi.fn().mockImplementation(() => ({
    getStatusForUser: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock('../transfer-guard', () => ({
  createTransferGuard: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));
vi.mock('../fx-rate-cache', () => ({
  getFxRateCache: vi.fn(() => ({ getCurrentRate: vi.fn().mockResolvedValue({}) })),
}));
vi.mock('../routes/docs', () => ({ default: { use: vi.fn(), get: vi.fn() } }));

describe('Rate limiting', () => {
  it('returns 429 with Retry-After header when limit exceeded', async () => {
    // Import app fresh for this test
    const { default: app } = await import('../api');

    // Exhaust the public limiter (max=100/min) by sending 101 requests
    // We use a path that hits the public limiter
    const responses = await Promise.all(
      Array.from({ length: 101 }, () =>
        request(app).get('/api/verification/verified')
      )
    );

    const blocked = responses.filter(r => r.status === 429);
    expect(blocked.length).toBeGreaterThan(0);

    const first429 = blocked[0];
    expect(first429.headers).toHaveProperty('retry-after');
    expect(Number(first429.headers['retry-after'])).toBeGreaterThan(0);
    expect(first429.body).toMatchObject({ error: 'Too many requests' });
  });
});
