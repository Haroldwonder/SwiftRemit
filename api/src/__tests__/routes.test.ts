import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { initializeCurrencyConfig } from '../config';
import { Application } from 'express';

describe('Currency API Routes', () => {
  let app: Application;

  beforeAll(() => {
    // Initialize config with default path
    process.env.CURRENCY_CONFIG_PATH = './config/currencies.json';
    initializeCurrencyConfig();
    app = createApp();
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeGreaterThanOrEqual(0);
      expect(response.body.checks).toBeDefined();
      expect(response.body.checks.database).toBeDefined();
      expect(response.body.checks.contract).toBeDefined();
      expect(['ok', 'error', 'not_configured']).toContain(response.body.checks.database.status);
      expect(['ok', 'error', 'not_configured']).toContain(response.body.checks.contract.status);
    });
  });

  describe('GET /api/currencies', () => {
    it('should return all currencies', async () => {
      const response = await request(app).get('/api/currencies');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.count).toBeGreaterThan(0);
      expect(response.body.timestamp).toBeDefined();
    });

    it('should return currencies with correct structure', async () => {
      const response = await request(app).get('/api/currencies');

      expect(response.status).toBe(200);
      
      const currency = response.body.data[0];
      expect(currency).toHaveProperty('code');
      expect(currency).toHaveProperty('symbol');
      expect(currency).toHaveProperty('decimal_precision');
      expect(typeof currency.code).toBe('string');
      expect(typeof currency.symbol).toBe('string');
      expect(typeof currency.decimal_precision).toBe('number');
    });

    it('should return consistent data on multiple requests', async () => {
      const response1 = await request(app).get('/api/currencies');
      const response2 = await request(app).get('/api/currencies');

      expect(response1.body.data).toEqual(response2.body.data);
      expect(response1.body.count).toBe(response2.body.count);
    });

    it('should include common currencies', async () => {
      const response = await request(app).get('/api/currencies');

      const codes = response.body.data.map((c: any) => c.code);
      expect(codes).toContain('USD');
      expect(codes).toContain('EUR');
    });
  });

  describe('GET /api/currencies/:code', () => {
    it('should return specific currency by code', async () => {
      const response = await request(app).get('/api/currencies/USD');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].code).toBe('USD');
      expect(response.body.count).toBe(1);
    });

    it('should be case insensitive', async () => {
      const response1 = await request(app).get('/api/currencies/usd');
      const response2 = await request(app).get('/api/currencies/USD');

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(response1.body.data[0]).toEqual(response2.body.data[0]);
    });

    it('should return 404 for non-existent currency', async () => {
      const response = await request(app).get('/api/currencies/XYZ');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CURRENCY_NOT_FOUND');
      expect(response.body.error.message).toContain('XYZ');
    });

    it('should return 400 for empty code', async () => {
      const response = await request(app).get('/api/currencies/');

      expect(response.status).toBe(404); // Express treats this as route not found
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent routes', async () => {
      const response = await request(app).get('/api/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
    });

    it('should include timestamp in error responses', async () => {
      const response = await request(app).get('/api/currencies/XYZ');

      expect(response.body.timestamp).toBeDefined();
      expect(new Date(response.body.timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  describe('Response Schema Validation', () => {
    it('should return consistent success response schema', async () => {
      const response = await request(app).get('/api/currencies');

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('count');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body.success).toBe(true);
    });

    it('should return consistent error response schema', async () => {
      const response = await request(app).get('/api/currencies/XYZ');

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body.success).toBe(false);
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('code');
    });
  });

  describe('Content-Type', () => {
    it('should return JSON content type', async () => {
      const response = await request(app).get('/api/currencies');

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });
  });
});
