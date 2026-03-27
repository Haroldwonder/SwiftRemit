import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../api';
import { initDatabase } from '../database';
import * as stellar from '../stellar';

describe('API Endpoints', () => {
  beforeAll(async () => {
    try {
      await initDatabase();
    } catch {
      // DB not available in CI/local without Postgres — tests that don't need DB still run
    }
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });

  describe('GET /api/verification/:assetCode/:issuer', () => {
    it('should return 400 for invalid asset code', async () => {
      const response = await request(app).get(
        '/api/verification/TOOLONGASSETCODE/GXXX'
      );
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid issuer', async () => {
      const response = await request(app).get('/api/verification/USDC/INVALID');
      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent asset', async () => {
      const response = await request(app).get(
        '/api/verification/NOTFOUND/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
      );
      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/verification/verify', () => {
    it('should verify an asset', async () => {
      const response = await request(app)
        .post('/api/verification/verify')
        .send({
          assetCode: 'USDC',
          issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.verification).toBeDefined();
    });

    it('should reject invalid input', async () => {
      const response = await request(app)
        .post('/api/verification/verify')
        .send({
          assetCode: 'TOOLONGASSETCODE',
          issuer: 'INVALID',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/verification/report', () => {
    it('should require reason', async () => {
      const response = await request(app)
        .post('/api/verification/report')
        .send({
          assetCode: 'USDC',
          issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        });

      expect(response.status).toBe(400);
    });

    it('should reject too long reason', async () => {
      const response = await request(app)
        .post('/api/verification/report')
        .send({
          assetCode: 'USDC',
          issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          reason: 'x'.repeat(501),
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/verification/verified', () => {
    it('should return verified assets', async () => {
      const response = await request(app).get('/api/verification/verified');
      expect(response.status).toBe(200);
      expect(response.body.assets).toBeDefined();
      expect(Array.isArray(response.body.assets)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const response = await request(app).get('/api/verification/verified?limit=10');
      expect(response.status).toBe(200);
      expect(response.body.assets.length).toBeLessThanOrEqual(10);
    });
  });

  describe('POST /api/verification/batch', () => {
    it('should handle batch requests', async () => {
      const response = await request(app)
        .post('/api/verification/batch')
        .send({
          assets: [
            {
              assetCode: 'USDC',
              issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.results).toBeDefined();
      expect(Array.isArray(response.body.results)).toBe(true);
    });

    it('should reject too many assets', async () => {
      const assets = Array(51).fill({
        assetCode: 'USDC',
        issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      });

      const response = await request(app)
        .post('/api/verification/batch')
        .send({ assets });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/simulate-settlement', () => {
    it('should return 400 when remittanceId is missing', async () => {
      const response = await request(app)
        .post('/api/simulate-settlement')
        .send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/remittanceId/);
    });

    it('should return 400 when remittanceId is zero', async () => {
      const response = await request(app)
        .post('/api/simulate-settlement')
        .send({ remittanceId: 0 });
      expect(response.status).toBe(400);
    });

    it('should return 400 when remittanceId is negative', async () => {
      const response = await request(app)
        .post('/api/simulate-settlement')
        .send({ remittanceId: -5 });
      expect(response.status).toBe(400);
    });

    it('should return 400 when remittanceId is not an integer', async () => {
      const response = await request(app)
        .post('/api/simulate-settlement')
        .send({ remittanceId: 1.5 });
      expect(response.status).toBe(400);
    });

    it('should return 400 when remittanceId is a string', async () => {
      const response = await request(app)
        .post('/api/simulate-settlement')
        .send({ remittanceId: 'abc' });
      expect(response.status).toBe(400);
    });

    it('should return 200 with simulation result for valid remittanceId', async () => {
      vi.spyOn(stellar, 'simulateSettlement').mockResolvedValueOnce({
        would_succeed: true,
        payout_amount: '9750',
        fee: '250',
        error_message: null,
      });

      const response = await request(app)
        .post('/api/simulate-settlement')
        .send({ remittanceId: 1 });

      expect(response.status).toBe(200);
      expect(response.body.would_succeed).toBe(true);
      expect(response.body.payout_amount).toBe('9750');
      expect(response.body.fee).toBe('250');
      expect(response.body.error_message).toBeNull();
    });

    it('should return 200 with would_succeed false when simulation fails', async () => {
      vi.spyOn(stellar, 'simulateSettlement').mockResolvedValueOnce({
        would_succeed: false,
        payout_amount: '0',
        fee: '0',
        error_message: null,
      });

      const response = await request(app)
        .post('/api/simulate-settlement')
        .send({ remittanceId: 999 });

      expect(response.status).toBe(200);
      expect(response.body.would_succeed).toBe(false);
    });
  });
});
