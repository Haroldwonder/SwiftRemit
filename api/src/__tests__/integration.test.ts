import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { initializeCurrencyConfig, getCurrencyConfigLoader } from '../config';
import { Application } from 'express';
import * as fs from 'fs';
import * as path from 'path';

describe('Currency API Integration Tests', () => {
  let app: Application;
  const testConfigPath = path.join(__dirname, 'integration-test-config.json');

  beforeAll(() => {
    // Create test configuration
    const testConfig = {
      currencies: [
        { code: 'USD', symbol: '$', decimal_precision: 2, name: 'US Dollar' },
        { code: 'EUR', symbol: '€', decimal_precision: 2, name: 'Euro' },
        { code: 'GBP', symbol: '£', decimal_precision: 2, name: 'British Pound' },
        { code: 'JPY', symbol: '¥', decimal_precision: 0, name: 'Japanese Yen' },
        { code: 'USDC', symbol: 'USDC', decimal_precision: 7, name: 'USD Coin' },
      ],
    };

    fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

    // Initialize with test config
    process.env.CURRENCY_CONFIG_PATH = testConfigPath;
    initializeCurrencyConfig();
    app = createApp();
  });

  afterAll(() => {
    // Clean up test config
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  describe('End-to-End Currency Retrieval', () => {
    it('should retrieve all currencies and verify structure', async () => {
      const response = await request(app).get('/api/currencies');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(5);
      expect(response.body.data).toHaveLength(5);

      // Verify each currency has required fields
      response.body.data.forEach((currency: any) => {
        expect(currency.code).toBeDefined();
        expect(currency.symbol).toBeDefined();
        expect(currency.decimal_precision).toBeDefined();
        expect(typeof currency.code).toBe('string');
        expect(typeof currency.symbol).toBe('string');
        expect(typeof currency.decimal_precision).toBe('number');
      });
    });

    it('should retrieve specific currencies by code', async () => {
      const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'USDC'];

      for (const code of currencies) {
        const response = await request(app).get(`/api/currencies/${code}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data[0].code).toBe(code);
      }
    });

    it('should handle multiple concurrent requests', async () => {
      const requests = Array(10)
        .fill(null)
        .map(() => request(app).get('/api/currencies'));

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.count).toBe(5);
      });
    });
  });

  describe('Configuration Changes Reflection', () => {
    it('should reflect configuration changes after reload', async () => {
      // Get initial state
      const initialResponse = await request(app).get('/api/currencies');
      const initialCount = initialResponse.body.count;

      // Modify configuration
      const updatedConfig = {
        currencies: [
          { code: 'USD', symbol: '$', decimal_precision: 2 },
          { code: 'EUR', symbol: '€', decimal_precision: 2 },
        ],
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(updatedConfig, null, 2));

      // Reload configuration
      const loader = getCurrencyConfigLoader();
      loader.reload();

      // Verify changes
      const updatedResponse = await request(app).get('/api/currencies');

      expect(updatedResponse.body.count).toBe(2);
      expect(updatedResponse.body.count).not.toBe(initialCount);

      // Restore original config
      const originalConfig = {
        currencies: [
          { code: 'USD', symbol: '$', decimal_precision: 2, name: 'US Dollar' },
          { code: 'EUR', symbol: '€', decimal_precision: 2, name: 'Euro' },
          { code: 'GBP', symbol: '£', decimal_precision: 2, name: 'British Pound' },
          { code: 'JPY', symbol: '¥', decimal_precision: 0, name: 'Japanese Yen' },
          { code: 'USDC', symbol: 'USDC', decimal_precision: 7, name: 'USD Coin' },
        ],
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(originalConfig, null, 2));
      loader.reload();
    });
  });

  describe('Error Scenarios', () => {
    it('should handle invalid currency codes gracefully', async () => {
      const invalidCodes = ['', '123', 'TOOLONG123456', 'invalid-code'];

      for (const code of invalidCodes) {
        const response = await request(app).get(`/api/currencies/${code}`);

        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.body.success).toBe(false);
      }
    });

    it('should return consistent error format', async () => {
      const response = await request(app).get('/api/currencies/NOTFOUND');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('code');
    });
  });

  describe('Performance', () => {
    it('should respond within acceptable time', async () => {
      const start = Date.now();
      await request(app).get('/api/currencies');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should respond within 1 second
    });

    it('should handle rapid sequential requests', async () => {
      const requests = [];
      for (let i = 0; i < 50; i++) {
        requests.push(request(app).get('/api/currencies'));
      }

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe('Data Integrity', () => {
    it('should maintain data consistency across requests', async () => {
      const response1 = await request(app).get('/api/currencies');
      const response2 = await request(app).get('/api/currencies');

      expect(JSON.stringify(response1.body.data)).toBe(JSON.stringify(response2.body.data));
    });

    it('should return immutable data', async () => {
      const response1 = await request(app).get('/api/currencies/USD');
      const response2 = await request(app).get('/api/currencies/USD');

      expect(response1.body.data[0]).toEqual(response2.body.data[0]);
    });
  });

  describe('Decimal Precision Validation', () => {
    it('should return correct decimal precision for each currency', async () => {
      const response = await request(app).get('/api/currencies');

      const usd = response.body.data.find((c: any) => c.code === 'USD');
      const jpy = response.body.data.find((c: any) => c.code === 'JPY');
      const usdc = response.body.data.find((c: any) => c.code === 'USDC');

      expect(usd.decimal_precision).toBe(2);
      expect(jpy.decimal_precision).toBe(0);
      expect(usdc.decimal_precision).toBe(7);
    });
  });
});
