import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Same mocks as rate-limit.test.ts
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
  saveContractEvent: vi.fn().mockResolvedValue(undefined),
  queryContractEvents: vi.fn().mockResolvedValue({ events: [], total: 0 }),
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
vi.mock('../routes/docs', () => {
  const mockRouter = Object.assign(vi.fn((_req: any, _res: any, next: any) => next()), { use: vi.fn(), get: vi.fn() });
  return { default: mockRouter };
});
vi.mock('../remittance/events', () => ({
  remittanceEventEmitter: { onStatusChange: vi.fn() },
}));
vi.mock('../metrics', () => ({
  getMetricsService: vi.fn(() => ({
    incrementRateLimitExceeded: vi.fn(),
    getMetrics: vi.fn().mockResolvedValue(''),
  })),
}));

describe('API key rate limiting', () => {
  let app: any;

  beforeEach(async () => {
    // Reset env to a low limit so tests run fast
    process.env.API_KEY_RATE_LIMIT_MAX = '3';
    process.env.API_KEY_RATE_LIMIT_WINDOW_MS = '60000';

    vi.resetModules();
    // Re-apply mocks after resetModules
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
      saveContractEvent: vi.fn().mockResolvedValue(undefined),
      queryContractEvents: vi.fn().mockResolvedValue({ events: [], total: 0 }),
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
    vi.mock('../routes/docs', () => {
      const mockRouter = Object.assign(vi.fn((_req: any, _res: any, next: any) => next()), { use: vi.fn(), get: vi.fn() });
      return { default: mockRouter };
    });
    vi.mock('../remittance/events', () => ({
      remittanceEventEmitter: { onStatusChange: vi.fn() },
    }));
    vi.mock('../metrics', () => ({
      getMetricsService: vi.fn(() => ({
        incrementRateLimitExceeded: vi.fn(),
        getMetrics: vi.fn().mockResolvedValue(''),
      })),
    }));

    const mod = await import('../api');
    app = mod.default;
  });

  it('includes X-RateLimit-* headers in responses', async () => {
    const res = await request(app)
      .get('/api/verification/verified')
      .set('x-api-key', 'test-key-headers');

    expect(res.headers).toHaveProperty('ratelimit-limit');
    expect(res.headers).toHaveProperty('ratelimit-remaining');
    expect(res.headers).toHaveProperty('ratelimit-reset');
  });

  it('returns 429 with error body when API key limit exceeded', async () => {
    const key = 'test-key-429';
    const max = 3;

    const responses = await Promise.all(
      Array.from({ length: max + 1 }, () =>
        request(app).get('/api/verification/verified').set('x-api-key', key)
      )
    );

    const blocked = responses.filter(r => r.status === 429);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].body).toMatchObject({ error: 'Rate limit exceeded', retryAfter: expect.any(Number) });
  });

  it('two different API keys have independent buckets', async () => {
    const keyA = 'test-key-A';
    const keyB = 'test-key-B';
    const max = 3;

    // Exhaust key A
    await Promise.all(
      Array.from({ length: max + 1 }, () =>
        request(app).get('/api/verification/verified').set('x-api-key', keyA)
      )
    );

    // Key B should NOT be rate-limited
    const resB = await request(app)
      .get('/api/verification/verified')
      .set('x-api-key', keyB);

    expect(resB.status).not.toBe(429);
  });

  it('accepts API key via Authorization: ApiKey header', async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .get('/api/verification/verified')
          .set('Authorization', 'ApiKey auth-header-key')
      )
    );

    const blocked = responses.filter(r => r.status === 429);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].body).toMatchObject({ error: 'Rate limit exceeded' });
  });
});
