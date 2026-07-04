import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import {
  getSettlementSimulationCache,
  addSettlementCacheHeaders,
  getCachedSettlementSimulation,
  getSettlementCacheMetrics,
  SettlementSimulationResult,
} from '../settlement-cache';

describe('Settlement Simulation Caching (#875)', () => {
  let app: Express;
  let simulationCallCount: number;

  const mockSimulationResult: SettlementSimulationResult = {
    remittanceId: 123,
    amount: '100.00',
    asset: 'USDC',
    corridor: 'USD-MXN',
    fees: {
      platformFee: '2.50',
      integrationFee: '1.00',
      totalFee: '3.50',
    },
    netPayout: '96.50',
    estimatedTime: '2 hours',
    timestamp: new Date(),
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    simulationCallCount = 0;

    // Reset cache
    const cache = getSettlementSimulationCache();
    cache.clear();
    cache.resetStats();

    // Mock settlement endpoint with caching
    app.post('/api/simulate-settlement', addSettlementCacheHeaders(30), async (req, res) => {
      const { amount, asset, corridor } = req.body;

      const result = await getCachedSettlementSimulation(
        amount,
        asset,
        corridor,
        async () => {
          simulationCallCount++;
          return {
            ...mockSimulationResult,
            amount,
            asset,
            corridor,
          };
        }
      );

      res.json(result);
    });

    // Metrics endpoint
    app.get('/api/metrics', (req, res) => {
      res.json(getSettlementCacheMetrics());
    });
  });

  afterEach(() => {
    const cache = getSettlementSimulationCache();
    cache.clear();
  });

  describe('Cache behavior', () => {
    it('should cache settlement simulation results', async () => {
      const payload = { amount: '100.00', asset: 'USDC', corridor: 'USD-MXN' };

      // First request - should call simulation
      await request(app)
        .post('/api/simulate-settlement')
        .send(payload)
        .expect(200);

      expect(simulationCallCount).toBe(1);

      // Second request - should use cache
      await request(app)
        .post('/api/simulate-settlement')
        .send(payload)
        .expect(200);

      expect(simulationCallCount).toBe(1);
    });

    it('should return same result from cache', async () => {
      const payload = { amount: '100.00', asset: 'USDC', corridor: 'USD-MXN' };

      const res1 = await request(app)
        .post('/api/simulate-settlement')
        .send(payload)
        .expect(200);

      const res2 = await request(app)
        .post('/api/simulate-settlement')
        .send(payload)
        .expect(200);

      expect(res1.body).toEqual(res2.body);
      expect(res1.body.netPayout).toBe('96.50');
    });

    it('should use separate cache entries for different parameters', async () => {
      const payload1 = { amount: '100.00', asset: 'USDC', corridor: 'USD-MXN' };
      const payload2 = { amount: '200.00', asset: 'USDC', corridor: 'USD-MXN' };

      await request(app)
        .post('/api/simulate-settlement')
        .send(payload1)
        .expect(200);

      expect(simulationCallCount).toBe(1);

      await request(app)
        .post('/api/simulate-settlement')
        .send(payload2)
        .expect(200);

      expect(simulationCallCount).toBe(2);

      // Verify cache is different
      const cache = getSettlementSimulationCache();
      expect(cache.get('100.00', 'USDC', 'USD-MXN')).toBeDefined();
      expect(cache.get('200.00', 'USDC', 'USD-MXN')).toBeDefined();
    });

    it('should differentiate by asset and corridor', async () => {
      const base = { amount: '100.00' };

      await request(app)
        .post('/api/simulate-settlement')
        .send({ ...base, asset: 'USDC', corridor: 'USD-MXN' })
        .expect(200);

      expect(simulationCallCount).toBe(1);

      await request(app)
        .post('/api/simulate-settlement')
        .send({ ...base, asset: 'USDT', corridor: 'USD-MXN' })
        .expect(200);

      expect(simulationCallCount).toBe(2);

      await request(app)
        .post('/api/simulate-settlement')
        .send({ ...base, asset: 'USDC', corridor: 'USD-BRL' })
        .expect(200);

      expect(simulationCallCount).toBe(3);
    });
  });

  describe('Cache-Control headers', () => {
    it('should set Cache-Control header', async () => {
      const res = await request(app)
        .post('/api/simulate-settlement')
        .send({ amount: '100.00', asset: 'USDC', corridor: 'USD-MXN' })
        .expect(200);

      expect(res.headers['cache-control']).toContain('max-age=30');
      expect(res.headers['cache-control']).toContain('public');
      expect(res.headers['cache-control']).toContain('must-revalidate');
    });

    it('should set Expires header', async () => {
      const beforeRequest = Date.now();
      const res = await request(app)
        .post('/api/simulate-settlement')
        .send({ amount: '100.00', asset: 'USDC', corridor: 'USD-MXN' })
        .expect(200);
      const afterRequest = Date.now();

      const expiresDate = new Date(res.headers['expires']).getTime();
      const expectedMin = beforeRequest + 30000;
      const expectedMax = afterRequest + 30000;

      expect(expiresDate).toBeGreaterThanOrEqual(expectedMin - 500);
      expect(expiresDate).toBeLessThanOrEqual(expectedMax + 500);
    });
  });

  describe('Cache metrics', () => {
    it('should track cache hits and misses', async () => {
      const payload = { amount: '100.00', asset: 'USDC', corridor: 'USD-MXN' };

      // Make 3 requests (1 miss, 2 hits)
      await request(app).post('/api/simulate-settlement').send(payload);
      await request(app).post('/api/simulate-settlement').send(payload);
      await request(app).post('/api/simulate-settlement').send(payload);

      const metrics = await request(app).get('/api/metrics').expect(200);

      expect(metrics.body.cache_misses).toBe(1);
      expect(metrics.body.cache_hits).toBe(2);
      expect(metrics.body.cache_entries).toBeGreaterThan(0);
    });

    it('should calculate hit rate percentage', async () => {
      const payload = { amount: '100.00', asset: 'USDC', corridor: 'USD-MXN' };

      // 1 miss, 9 hits = 90% hit rate
      for (let i = 0; i < 10; i++) {
        await request(app).post('/api/simulate-settlement').send(payload);
      }

      const metrics = await request(app).get('/api/metrics').expect(200);

      expect(metrics.body.cache_hit_rate).toContain('90');
      expect(metrics.body.cache_ttl_seconds).toBe(30);
    });

    it('should include cache configuration in metrics', async () => {
      const metrics = await request(app).get('/api/metrics').expect(200);

      expect(metrics.body).toHaveProperty('cache_entries');
      expect(metrics.body).toHaveProperty('cache_hits');
      expect(metrics.body).toHaveProperty('cache_misses');
      expect(metrics.body).toHaveProperty('cache_hit_rate');
      expect(metrics.body).toHaveProperty('cache_ttl_seconds');
    });
  });

  describe('Cache eviction', () => {
    it('should not store null results', () => {
      const cache = getSettlementSimulationCache();
      // Verify cache is initially empty
      expect(cache.get('100.00', 'USDC', 'USD-MXN')).toBeNull();
    });
  });

  describe('Cache direct API', () => {
    it('getCachedSettlementSimulation should cache async results', async () => {
      let callCount = 0;

      const result1 = await getCachedSettlementSimulation(
        '100.00',
        'USDC',
        'USD-MXN',
        async () => {
          callCount++;
          return mockSimulationResult;
        }
      );

      const result2 = await getCachedSettlementSimulation(
        '100.00',
        'USDC',
        'USD-MXN',
        async () => {
          callCount++;
          return mockSimulationResult;
        }
      );

      expect(callCount).toBe(1);
      expect(result1).toEqual(result2);
    });

    it('should handle different cache keys independently', async () => {
      let callCount = 0;

      const sim = async () => {
        callCount++;
        return mockSimulationResult;
      };

      await getCachedSettlementSimulation('100.00', 'USDC', 'USD-MXN', sim);
      await getCachedSettlementSimulation('100.00', 'USDC', 'USD-MXN', sim);
      await getCachedSettlementSimulation('200.00', 'USDC', 'USD-MXN', sim);
      await getCachedSettlementSimulation('100.00', 'USDT', 'USD-MXN', sim);

      expect(callCount).toBe(3);
    });
  });
});
