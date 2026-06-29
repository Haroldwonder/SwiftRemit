import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import { Pool } from 'pg';
import { createAnalyticsRouter, TimeSeriesResponse } from '../routes/analytics';

describe('Corridor Analytics (Issue #876)', () => {
  let app: Application;
  const ADMIN_API_KEY = 'test-admin-key-12345';

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mock pool with basic implementation
    const mockPool = {
      query: async (sql: string, params?: unknown[]) => {
        // Time-series mock data
        if (sql.includes('DATE_TRUNC')) {
          return {
            rows: [
              {
                bucket: new Date('2025-06-01').toISOString(),
                volume: '1000.00',
                count: '10',
                fees: '50.00',
              },
              {
                bucket: new Date('2025-06-02').toISOString(),
                volume: '1500.00',
                count: '15',
                fees: '75.00',
              },
            ],
          };
        }
        // Aggregated mock data
        return {
          rows: [
            {
              source_currency: 'USDC',
              destination_country: 'UG',
              total_volume: '5000.00',
              transaction_count: '50',
              success_count: '45',
              failure_count: '5',
              avg_fee: '50.00',
              total_fees: '2500.00',
            },
          ],
        };
      },
    } as unknown as Pool;

    const router = createAnalyticsRouter(mockPool, ADMIN_API_KEY);
    app.use('/api/analytics', router);
  });

  describe('GET /api/analytics/timeseries', () => {
    it('should require API key', async () => {
      const response = await request(app).get('/api/analytics/timeseries?corridor=USDC_UG');
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should require corridor parameter', async () => {
      const response = await request(app)
        .get('/api/analytics/timeseries')
        .set('x-api-key', ADMIN_API_KEY);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('MISSING_CORRIDOR');
    });

    it('should validate corridor format', async () => {
      const response = await request(app)
        .get('/api/analytics/timeseries?corridor=invalid')
        .set('x-api-key', ADMIN_API_KEY);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_CORRIDOR_FORMAT');
    });

    it('should validate interval parameter', async () => {
      const response = await request(app)
        .get('/api/analytics/timeseries?corridor=USDC_UG&interval=invalid')
        .set('x-api-key', ADMIN_API_KEY);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_INTERVAL');
    });

    it('should validate range parameter', async () => {
      const response = await request(app)
        .get('/api/analytics/timeseries?corridor=USDC_UG&range=invalid')
        .set('x-api-key', ADMIN_API_KEY);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_RANGE');
    });

    it('should return time-series data with default params', async () => {
      const response = await request(app)
        .get('/api/analytics/timeseries?corridor=USDC_UG')
        .set('x-api-key', ADMIN_API_KEY);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      const data = response.body.data as TimeSeriesResponse['data'];
      expect(data.corridor).toBe('USDC_UG');
      expect(data.interval).toBe('1d');
      expect(data.range).toBe('30d');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
    });

    it('should return time-series data with custom interval', async () => {
      const response = await request(app)
        .get('/api/analytics/timeseries?corridor=USDC_UG&interval=1h')
        .set('x-api-key', ADMIN_API_KEY);

      expect(response.status).toBe(200);
      const data = response.body.data as TimeSeriesResponse['data'];
      expect(data.interval).toBe('1h');
    });

    it('should return time-series data with custom range', async () => {
      const response = await request(app)
        .get('/api/analytics/timeseries?corridor=USDC_UG&range=7d')
        .set('x-api-key', ADMIN_API_KEY);

      expect(response.status).toBe(200);
      const data = response.body.data as TimeSeriesResponse['data'];
      expect(data.range).toBe('7d');
    });

    it('should include volume, transaction_count, and fees in data points', async () => {
      const response = await request(app)
        .get('/api/analytics/timeseries?corridor=USDC_UG')
        .set('x-api-key', ADMIN_API_KEY);

      expect(response.status).toBe(200);
      const data = response.body.data as TimeSeriesResponse['data'];
      const point = data.data[0];
      
      expect(point.timestamp).toBeDefined();
      expect(typeof point.volume).toBe('number');
      expect(typeof point.transaction_count).toBe('number');
      expect(typeof point.fees).toBe('number');
    });

    it('should support all valid intervals', async () => {
      for (const interval of ['1h', '1d', '1w']) {
        const response = await request(app)
          .get(`/api/analytics/timeseries?corridor=USDC_UG&interval=${interval}`)
          .set('x-api-key', ADMIN_API_KEY);
        expect(response.status).toBe(200);
        expect(response.body.data.interval).toBe(interval);
      }
    });

    it('should support all valid ranges', async () => {
      for (const range of ['7d', '30d', '90d']) {
        const response = await request(app)
          .get(`/api/analytics/timeseries?corridor=USDC_UG&range=${range}`)
          .set('x-api-key', ADMIN_API_KEY);
        expect(response.status).toBe(200);
        expect(response.body.data.range).toBe(range);
      }
    });
  });

  describe('GET /api/analytics/corridors', () => {
    it('should require API key', async () => {
      const response = await request(app).get('/api/analytics/corridors');
      expect(response.status).toBe(401);
    });

    it('should return aggregated corridor data', async () => {
      const response = await request(app)
        .get('/api/analytics/corridors')
        .set('x-api-key', ADMIN_API_KEY);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.corridors)).toBe(true);
    });
  });
});
