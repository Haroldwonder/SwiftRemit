import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { correlationIdMiddleware } from '../correlation-middleware';
import { getCorrelationId } from '../correlation-id';
import { AssetVerifier } from '../verifier';
import { WebhookHandler } from '../webhook-handler';
import { Pool } from 'pg';

// Mock the database and external services
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn(),
      release: vi.fn()
    })
  }))
}));

vi.mock('../verifier', () => ({
  AssetVerifier: vi.fn().mockImplementation(() => ({
    verifyAsset: vi.fn().mockResolvedValue({
      asset_code: 'TEST',
      issuer: 'GBTEST',
      status: 'verified',
      reputation_score: 85,
      sources: [],
      trustline_count: 100,
      has_toml: true
    })
  }))
}));

describe('End-to-End Correlation ID Flow', () => {
  let app: express.Application;
  let pool: Pool;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(correlationIdMiddleware());

    pool = new Pool();
    
    // Add a test endpoint that uses correlation ID
    app.get('/test', (req, res) => {
      const correlationId = getCorrelationId();
      res.json({
        message: 'Test endpoint',
        correlationId,
        hasCorrelationId: !!correlationId
      });
    });

    // Add a test endpoint that simulates asset verification
    app.post('/test/verify', async (req, res) => {
      const correlationId = getCorrelationId();
      const verifier = new AssetVerifier();
      const result = await verifier.verifyAsset('TEST', 'GBTEST');
      
      res.json({
        message: 'Asset verification',
        correlationId,
        result
      });
    });

    // Add a test endpoint that simulates webhook processing
    app.post('/test/webhook', async (req, res) => {
      const correlationId = getCorrelationId();
      const webhookHandler = new WebhookHandler(pool);
      
      // Mock request with rawBody
      const mockReq = {
        ...req,
        rawBody: JSON.stringify(req.body),
        headers: {
          ...req.headers,
          'x-signature': 'test-signature',
          'x-timestamp': Date.now().toString(),
          'x-nonce': 'test-nonce',
          'x-anchor-id': 'test-anchor'
        }
      } as any;

      try {
        await webhookHandler.handleWebhook(mockReq, res);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
          message: 'Webhook processing error',
          correlationId,
          error: errorMessage
        });
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('API Endpoints', () => {
    it('should include correlation ID in all API responses', async () => {
      const response = await request(app)
        .get('/test')
        .expect(200);

      expect(response.body).toHaveProperty('correlationId');
      expect(response.body).toHaveProperty('hasCorrelationId', true);
      expect(response.body.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      
      // Verify X-Correlation-ID header is present
      expect(response.headers).toHaveProperty('x-correlation-id');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);
    });

    it('should maintain correlation ID across async operations', async () => {
      const response = await request(app)
        .post('/test/verify')
        .send({ assetCode: 'TEST', issuer: 'GBTEST' })
        .expect(200);

      expect(response.body).toHaveProperty('correlationId');
      expect(response.body).toHaveProperty('result');
      expect(response.body.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      
      // Verify X-Correlation-ID header is present
      expect(response.headers).toHaveProperty('x-correlation-id');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);
    });

    it('should use provided correlation ID from headers', async () => {
      const providedCorrelationId = 'provided-test-id-12345';
      
      const response = await request(app)
        .get('/test')
        .set('X-Correlation-ID', providedCorrelationId)
        .expect(200);

      expect(response.body.correlationId).toBe(providedCorrelationId);
      expect(response.headers['x-correlation-id']).toBe(providedCorrelationId);
    });

    it('should extract user ID from headers', async () => {
      const userId = 'test-user-123';
      
      const response = await request(app)
        .get('/test')
        .set('X-User-ID', userId)
        .expect(200);

      expect(response.body).toHaveProperty('correlationId');
      expect(response.body).toHaveProperty('hasCorrelationId', true);
    });

    it('should extract anchor ID from headers', async () => {
      const anchorId = 'test-anchor-123';
      
      const response = await request(app)
        .get('/test')
        .set('X-Anchor-ID', anchorId)
        .expect(200);

      expect(response.body).toHaveProperty('correlationId');
      expect(response.body).toHaveProperty('hasCorrelationId', true);
    });
  });

  describe('Webhook Processing', () => {
    it('should process webhooks with correlation ID', async () => {
      const webhookData = {
        event_type: 'deposit_update',
        transaction_id: 'test-transaction-123',
        status: 'pending_anchor',
        amount_in: '100.0',
        amount_out: '99.0',
        amount_fee: '1.0'
      };

      // Mock successful database queries
      (pool.query as any).mockResolvedValue({ rows: [{ public_key: 'test-key', webhook_secret: 'test-secret' }] });

      const response = await request(app)
        .post('/test/webhook')
        .send(webhookData)
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Webhook processing');
    });

    it('should handle webhook errors with correlation ID', async () => {
      const webhookData = {
        event_type: 'invalid_event',
        transaction_id: 'test-transaction-123'
      };

      const response = await request(app)
        .post('/test/webhook')
        .send(webhookData)
        .expect(500);

      expect(response.body).toHaveProperty('correlationId');
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Correlation ID Consistency', () => {
    it('should generate unique correlation IDs for different requests', async () => {
      const response1 = await request(app).get('/test');
      const response2 = await request(app).get('/test');

      expect(response1.body.correlationId).not.toBe(response2.body.correlationId);
      expect(response1.headers['x-correlation-id']).not.toBe(response2.headers['x-correlation-id']);
    });

    it('should maintain correlation ID within a single request lifecycle', async () => {
      // This test verifies that the correlation ID remains consistent
      // throughout the request processing, including in async operations
      
      const response = await request(app)
        .post('/test/verify')
        .send({ assetCode: 'TEST', issuer: 'GBTEST' })
        .expect(200);

      // The correlation ID should be the same in the response body and header
      expect(response.body.correlationId).toBe(response.headers['x-correlation-id']);
    });
  });

  describe('Error Handling', () => {
    it('should include correlation ID in error responses', async () => {
      const response = await request(app)
        .get('/nonexistent')
        .expect(404);

      // Even for 404 errors, the correlation ID should be included
      expect(response.headers).toHaveProperty('x-correlation-id');
      expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should handle middleware errors gracefully', async () => {
      // Test that the middleware doesn't break when there are errors
      const response = await request(app)
        .post('/test')
        .send('invalid json')
        .expect(400);

      // Even for parsing errors, correlation ID should be present
      expect(response.headers).toHaveProperty('x-correlation-id');
    });
  });

  describe('Integration with External Services', () => {
    it('should propagate correlation ID to external service calls', async () => {
      // Mock the verifier to check if correlation ID is available during verification
      const mockVerifyAsset = vi.fn().mockImplementation(async (assetCode: string, issuer: string) => {
        const correlationId = getCorrelationId();
        expect(correlationId).toBeDefined();
        expect(correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        
        return {
          asset_code: assetCode,
          issuer,
          status: 'verified',
          reputation_score: 85,
          sources: [],
          trustline_count: 100,
          has_toml: true
        };
      });

      // Replace the mock implementation
      (AssetVerifier as any).mockImplementation(() => ({
        verifyAsset: mockVerifyAsset
      }));

      const response = await request(app)
        .post('/test/verify')
        .send({ assetCode: 'TEST', issuer: 'GBTEST' })
        .expect(200);

      expect(mockVerifyAsset).toHaveBeenCalled();
      expect(response.body).toHaveProperty('correlationId');
    });
  });
});