import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const db = vi.hoisted(() => ({
  corridors: [
    {
      source_country: 'US',
      destination_country: 'MX',
      active: true,
      min_amount: 100,
      max_amount: 10000,
      supported_assets: ['USDC', 'USDT'],
      fee_bps: 250,
      estimated_delivery_hours: 2,
    },
    {
      source_country: 'GB',
      destination_country: 'NG',
      active: true,
      min_amount: 50,
      max_amount: 5000,
      supported_assets: ['USDC'],
      fee_bps: 500,
      estimated_delivery_hours: 4,
    },
    {
      source_country: 'US',
      destination_country: 'PH',
      active: false,
      min_amount: 100,
      max_amount: 8000,
      supported_assets: ['USDC'],
      fee_bps: 300,
      estimated_delivery_hours: 24,
    },
  ],
  cacheTime: 0,
}));

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

vi.mock('../database', () => ({
  initDatabase: vi.fn().mockResolvedValue(undefined),
  getPool: vi.fn(() => ({ query: vi.fn(), connect: vi.fn() })),
}));

vi.mock('../stellar', () => ({
  storeVerificationOnChain: vi.fn().mockResolvedValue(undefined),
}));

import app from '../api';

describe('Corridor Availability', () => {
  beforeEach(() => {
    db.cacheTime = Date.now();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('GET /api/corridors', () => {
    it('should return list of active corridors', async () => {
      const response = await request(app).get('/api/corridors');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.corridors)).toBe(true);
      
      // Should only include active corridors
      response.body.corridors.forEach((corridor: any) => {
        expect(corridor.active).toBe(true);
      });
    });

    it('should include corridor details', async () => {
      const response = await request(app).get('/api/corridors');

      expect(response.status).toBe(200);
      const corridor = response.body.corridors[0];

      expect(corridor).toHaveProperty('source_country');
      expect(corridor).toHaveProperty('destination_country');
      expect(corridor).toHaveProperty('min_amount');
      expect(corridor).toHaveProperty('max_amount');
      expect(corridor).toHaveProperty('supported_assets');
      expect(corridor).toHaveProperty('fee_bps');
      expect(corridor).toHaveProperty('estimated_delivery_hours');
    });

    it('should include min/max amounts', async () => {
      const response = await request(app).get('/api/corridors');

      expect(response.status).toBe(200);
      response.body.corridors.forEach((corridor: any) => {
        expect(corridor.min_amount).toBeGreaterThan(0);
        expect(corridor.max_amount).toBeGreaterThanOrEqual(corridor.min_amount);
      });
    });

    it('should include supported assets', async () => {
      const response = await request(app).get('/api/corridors');

      expect(response.status).toBe(200);
      response.body.corridors.forEach((corridor: any) => {
        expect(Array.isArray(corridor.supported_assets)).toBe(true);
        expect(corridor.supported_assets.length).toBeGreaterThan(0);
      });
    });

    it('should include fee range', async () => {
      const response = await request(app).get('/api/corridors');

      expect(response.status).toBe(200);
      response.body.corridors.forEach((corridor: any) => {
        expect(corridor.fee_bps).toBeGreaterThanOrEqual(0);
        expect(corridor.fee_bps).toBeLessThanOrEqual(10000);
      });
    });

    it('should include estimated delivery time', async () => {
      const response = await request(app).get('/api/corridors');

      expect(response.status).toBe(200);
      response.body.corridors.forEach((corridor: any) => {
        expect(corridor.estimated_delivery_hours).toBeGreaterThan(0);
      });
    });

    it('should cache response with 5 minute TTL', async () => {
      const response1 = await request(app).get('/api/corridors');
      expect(response1.status).toBe(200);
      
      const cacheHeaders = response1.headers['cache-control'];
      expect(cacheHeaders).toBeDefined();
      expect(cacheHeaders).toContain('max-age=300'); // 5 minutes
    });

    it('should return consistent cached data within TTL', async () => {
      const response1 = await request(app).get('/api/corridors');
      expect(response1.status).toBe(200);
      const data1 = JSON.stringify(response1.body);

      const response2 = await request(app).get('/api/corridors');
      expect(response2.status).toBe(200);
      const data2 = JSON.stringify(response2.body);

      expect(data1).toBe(data2);
    });
  });

  describe('Corridor Filtering', () => {
    it('should filter by source country', async () => {
      const response = await request(app)
        .get('/api/corridors')
        .query({ source: 'US' });

      expect(response.status).toBe(200);
      response.body.corridors.forEach((corridor: any) => {
        expect(corridor.source_country).toBe('US');
      });
    });

    it('should filter by destination country', async () => {
      const response = await request(app)
        .get('/api/corridors')
        .query({ destination: 'MX' });

      expect(response.status).toBe(200);
      response.body.corridors.forEach((corridor: any) => {
        expect(corridor.destination_country).toBe('MX');
      });
    });

    it('should filter by asset', async () => {
      const response = await request(app)
        .get('/api/corridors')
        .query({ asset: 'USDC' });

      expect(response.status).toBe(200);
      response.body.corridors.forEach((corridor: any) => {
        expect(corridor.supported_assets).toContain('USDC');
      });
    });

    it('should combine multiple filters', async () => {
      const response = await request(app)
        .get('/api/corridors')
        .query({ source: 'US', destination: 'MX', asset: 'USDC' });

      expect(response.status).toBe(200);
      response.body.corridors.forEach((corridor: any) => {
        expect(corridor.source_country).toBe('US');
        expect(corridor.destination_country).toBe('MX');
        expect(corridor.supported_assets).toContain('USDC');
      });
    });
  });

  describe('Frontend Integration', () => {
    it('should populate corridor selection dropdown', async () => {
      const response = await request(app).get('/api/corridors');

      expect(response.status).toBe(200);
      expect(response.body.corridors.length).toBeGreaterThan(0);

      // Verify structure is suitable for dropdown
      response.body.corridors.forEach((corridor: any) => {
        expect(corridor).toHaveProperty('source_country');
        expect(corridor).toHaveProperty('destination_country');
        expect(corridor).toHaveProperty('active');
      });
    });

    it('should provide fee breakdown for UI display', async () => {
      const response = await request(app).get('/api/corridors');

      expect(response.status).toBe(200);
      response.body.corridors.forEach((corridor: any) => {
        // Fee should be convertible to percentage for display
        const feePercent = corridor.fee_bps / 100;
        expect(feePercent).toBeGreaterThanOrEqual(0);
        expect(feePercent).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid filter values gracefully', async () => {
      const response = await request(app)
        .get('/api/corridors')
        .query({ fee_bps: 'invalid' });

      // Should either ignore invalid param or return 400
      expect([200, 400]).toContain(response.status);
    });

    it('should return empty array when no corridors match filters', async () => {
      const response = await request(app)
        .get('/api/corridors')
        .query({ source: 'ZZ', destination: 'YY' });

      expect(response.status).toBe(200);
      expect(response.body.corridors).toStrictEqual([]);
    });
  });
});
