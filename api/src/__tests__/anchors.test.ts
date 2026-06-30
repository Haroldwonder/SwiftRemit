import { beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { newDb } from 'pg-mem';
import { PostgresAnchorStore } from '../db/anchorStore';
import { DEFAULT_ANCHORS } from '../data/defaultAnchors';

describe('Anchors API', () => {
  const adminApiKey = 'test-anchor-admin-key';
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const db = newDb();
    const pg = db.adapters.createPg();
    const pool = new pg.Pool();
    const store = new PostgresAnchorStore(pool);

    await store.initializeSchema();
    await store.seed(DEFAULT_ANCHORS);

    app = createApp({
      anchorStore: store,
      anchorAdminApiKey: adminApiKey,
    });
  });

  describe('GET /api/anchors', () => {
    it('should return all active anchors', async () => {
      const response = await request(app)
        .get('/api/anchors?status=active')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.count).toBe(3);
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.data.map((anchor: any) => anchor.id)).toEqual([
        'anchor-1',
        'anchor-2',
        'anchor-3',
      ]);
    });

    it('should filter anchors by currency', async () => {
      const response = await request(app)
        .get('/api/anchors?currency=USD')
        .expect(200);

      expect(response.body.success).toBe(true);
      response.body.data.forEach((anchor: any) => {
        expect(anchor.supported_currencies).toContain('USD');
      });
    });

    it('should return anchor with complete structure', async () => {
      const response = await request(app)
        .get('/api/anchors')
        .expect(200);

      const anchor = response.body.data[0];
      expect(anchor).toHaveProperty('id');
      expect(anchor).toHaveProperty('name');
      expect(anchor).toHaveProperty('fees');
      expect(anchor).toHaveProperty('limits');
      expect(anchor).toHaveProperty('compliance');
      expect(anchor.fees).toHaveProperty('deposit_fee_percent');
      expect(anchor.fees).toHaveProperty('withdrawal_fee_percent');
      expect(anchor.limits).toHaveProperty('min_amount');
      expect(anchor.limits).toHaveProperty('max_amount');
      expect(anchor.compliance).toHaveProperty('kyc_required');
      expect(anchor.compliance).toHaveProperty('kyc_level');
    });
  });

  describe('GET /api/anchors/:id', () => {
    it('should return specific anchor by id', async () => {
      const response = await request(app)
        .get('/api/anchors/anchor-1')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('anchor-1');
      expect(response.body.data.name).toBe('MoneyGram Access');
    });

    it('should return 404 for non-existent anchor', async () => {
      const response = await request(app)
        .get('/api/anchors/non-existent')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ANCHOR_NOT_FOUND');
    });
  });

  describe('Admin anchor management', () => {
    const newAnchor = {
      id: 'anchor-4',
      name: 'SwiftRemit Partner',
      domain: 'partner.swiftremit.io',
      logo_url: 'https://example.com/partner-logo.png',
      description: 'Regional payout partner',
      status: 'active',
      fees: {
        deposit_fee_percent: 1.2,
        withdrawal_fee_percent: 1.7,
      },
      limits: {
        min_amount: 20,
        max_amount: 15000,
        daily_limit: 30000,
      },
      compliance: {
        kyc_required: true,
        kyc_level: 'basic',
        supported_countries: ['NG', 'GH'],
        restricted_countries: ['KP'],
        documents_required: ['government_id'],
      },
      supported_currencies: ['USD', 'NGN'],
      processing_time: 'Same day',
      rating: 4.1,
      total_transactions: 1200,
      verified: true,
    };

    it('should reject admin requests without a valid API key', async () => {
      const response = await request(app)
        .post('/api/anchors/admin')
        .send(newAnchor)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should create, update, deactivate, and delete anchors through admin endpoints', async () => {
      const createResponse = await request(app)
        .post('/api/anchors/admin')
        .set('x-api-key', adminApiKey)
        .send(newAnchor)
        .expect(201);

      expect(createResponse.body.success).toBe(true);
      expect(createResponse.body.data.id).toBe('anchor-4');

      const getCreated = await request(app)
        .get('/api/anchors/anchor-4')
        .expect(200);

      expect(getCreated.body.data.name).toBe('SwiftRemit Partner');

      const updateResponse = await request(app)
        .put('/api/anchors/admin/anchor-4')
        .set('x-api-key', adminApiKey)
        .send({
          processing_time: 'Next business day',
          supported_currencies: ['USD', 'NGN', 'GHS'],
        })
        .expect(200);

      expect(updateResponse.body.data.processing_time).toBe('Next business day');
      expect(updateResponse.body.data.supported_currencies).toContain('GHS');

      const deactivateResponse = await request(app)
        .post('/api/anchors/admin/anchor-4/deactivate')
        .set('x-api-key', adminApiKey)
        .expect(200);

      expect(deactivateResponse.body.data.status).toBe('inactive');

      await request(app)
        .get('/api/anchors/anchor-4')
        .expect(404);

      const deleteResponse = await request(app)
        .delete('/api/anchors/admin/anchor-4')
        .set('x-api-key', adminApiKey)
        .expect(200);

      expect(deleteResponse.body.success).toBe(true);
      expect(deleteResponse.body.data.id).toBe('anchor-4');
    });
  });
});
