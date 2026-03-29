import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { createWebhookVerificationMiddleware, WebhookRequest } from '../webhook-middleware';

/**
 * Test helper to create HMAC signature
 */
function createHmacSignature(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Test helper to create app with webhook middleware
 */
function createTestApp(
  secret: string,
  verificationMiddleware: any
): Express {
  const app = express();
  
  // Parse JSON body
  app.use(express.json());
  
  // Apply webhook verification middleware
  app.use('/webhooks', verificationMiddleware);
  
  // Test endpoint
  app.post('/webhooks/test', (req: Request, res: Response) => {
    res.json({ success: true, received: req.body });
  });
  
  // Health check (should bypass verification)
  app.get('/webhooks/health', (req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });
  
  return app;
}

describe('Webhook Verification Middleware', () => {
  const TEST_SECRET = 'test-webhook-secret-12345';
  let app: Express;

  beforeEach(() => {
    // Set environment variable for test
    process.env.WEBHOOK_SECRET_TEST_ANCHOR = TEST_SECRET;
  });

  describe('Valid Requests', () => {
    it('should accept request with valid signature', async () => {
      const middleware = createWebhookVerificationMiddleware({
        getAnchorSecret: async () => TEST_SECRET,
      });
      
      app = createTestApp(TEST_SECRET, middleware);
      
      const payload = JSON.stringify({ event: 'test' });
      const signature = createHmacSignature(payload, TEST_SECRET);
      
      const response = await request(app)
        .post('/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('x-signature', signature)
        .set('x-timestamp', new Date().toISOString())
        .set('x-nonce', crypto.randomUUID())
        .set('x-anchor-id', 'test-anchor')
        .send(payload);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should accept request without signature when requireSignature is false', async () => {
      const middleware = createWebhookVerificationMiddleware({
        getAnchorSecret: async () => TEST_SECRET,
        requireSignature: false,
      });
      
      app = createTestApp(TEST_SECRET, middleware);
      
      const response = await request(app)
        .post('/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('x-anchor-id', 'test-anchor')
        .send({ event: 'test' });
      
      expect(response.status).toBe(200);
    });

    it('should allow health check without verification', async () => {
      const middleware = createWebhookVerificationMiddleware({
        getAnchorSecret: async () => TEST_SECRET,
      });
      
      app = createTestApp(TEST_SECRET, middleware);
      
      const response = await request(app).get('/webhooks/health');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });

  describe('Invalid Signatures', () => {
    it('should reject request with invalid signature', async () => {
      const middleware = createWebhookVerificationMiddleware({
        getAnchorSecret: async () => TEST_SECRET,
      });
      
      app = createTestApp(TEST_SECRET, middleware);
      
      const payload = JSON.stringify({ event: 'test' });
      const invalidSignature = createHmacSignature(payload, 'wrong-secret');
      
      const response = await request(app)
        .post('/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('x-signature', invalidSignature)
        .set('x-timestamp', new Date().toISOString())
        .set('x-nonce', crypto.randomUUID())
        .set('x-anchor-id', 'test-anchor')
        .send(payload);
      
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_SIGNATURE');
    });

    it('should reject request with tampered payload', async () => {
      const middleware = createWebhookVerificationMiddleware({
        getAnchorSecret: async () => TEST_SECRET,
      });
      
      app = createTestApp(TEST_SECRET, middleware);
      
      // Create valid signature for original payload
      const originalPayload = JSON.stringify({ event: 'test', amount: 100 });
      const signature = createHmacSignature(originalPayload, TEST_SECRET);
      
      // Send with different payload but same signature (tampered)
      const tamperedPayload = JSON.stringify({ event: 'test', amount: 999999 });
      
      const response = await request(app)
        .post('/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('x-signature', signature)
        .set('x-timestamp', new Date().toISOString())
        .set('x-nonce', crypto.randomUUID())
        .set('x-anchor-id', 'test-anchor')
        .send(tamperedPayload);
      
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_SIGNATURE');
    });

    it('should reject request with missing signature when required', async () => {
      const middleware = createWebhookVerificationMiddleware({
        getAnchorSecret: async () => TEST_SECRET,
        requireSignature: true,
      });
      
      app = createTestApp(TEST_SECRET, middleware);
      
      const response = await request(app)
        .post('/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('x-anchor-id', 'test-anchor')
        .send({ event: 'test' });
      
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('MISSING_SIGNATURE');
    });

    it('should reject request with missing anchor-id header', async () => {
      const middleware = createWebhookVerificationMiddleware({
        getAnchorSecret: async () => TEST_SECRET,
      });
      
      app = createTestApp(TEST_SECRET, middleware);
      
      const response = await request(app)
        .post('/webhooks/test')
        .set('Content-Type', 'application/json')
        .send({ event: 'test' });
      
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('MISSING_ANCHOR_ID');
    });
  });

  describe('Timestamp Validation', () => {
    it('should reject request with expired timestamp', async () => {
      const middleware = createWebhookVerificationMiddleware({
        getAnchorSecret: async () => TEST_SECRET,
        timestampWindowSeconds: 300,
      });
      
      app = createTestApp(TEST_SECRET, middleware);
      
      const payload = JSON.stringify({ event: 'test' });
      const signature = createHmacSignature(payload, TEST_SECRET);
      
      // Timestamp from 10 minutes ago (beyond 5-minute window)
      const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      
      const response = await request(app)
        .post('/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('x-signature', signature)
        .set('x-timestamp', oldTimestamp)
        .set('x-nonce', crypto.randomUUID())
        .set('x-anchor-id', 'test-anchor')
        .send(payload);
      
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_TIMESTAMP');
    });

    it('should reject request with future-dated timestamp', async () => {
      const middleware = createWebhookVerificationMiddleware({
        getAnchorSecret: async () => TEST_SECRET,
        timestampWindowSeconds: 300,
      });
      
      app = createTestApp(TEST_SECRET, middleware);
      
      const payload = JSON.stringify({ event: 'test' });
      const signature = createHmacSignature(payload, TEST_SECRET);
      
      // Timestamp from 10 minutes in the future
      const futureTimestamp = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      
      const response = await request(app)
        .post('/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('x-signature', signature)
        .set('x-timestamp', futureTimestamp)
        .set('x-nonce', crypto.randomUUID())
        .set('x-anchor-id', 'test-anchor')
        .send(payload);
      
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_TIMESTAMP');
    });
  });

  describe('Nonce Validation (Replay Attack Prevention)', () => {
    it('should reject duplicate nonce', async () => {
      const middleware = createWebhookVerificationMiddleware({
        getAnchorSecret: async () => TEST_SECRET,
      });
      
      app = createTestApp(TEST_SECRET, middleware);
      
      const payload = JSON.stringify({ event: 'test' });
      const signature = createHmacSignature(payload, TEST_SECRET);
      const nonce = crypto.randomUUID();
      
      // First request with this nonce - should succeed
      await request(app)
        .post('/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('x-signature', signature)
        .set('x-timestamp', new Date().toISOString())
        .set('x-nonce', nonce)
        .set('x-anchor-id', 'test-anchor')
        .send(payload);
      
      // Second request with same nonce - should fail (replay attack)
      const response = await request(app)
        .post('/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('x-signature', signature)
        .set('x-timestamp', new Date().toISOString())
        .set('x-nonce', nonce)
        .set('x-anchor-id', 'test-anchor')
        .send(payload);
      
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_NONCE');
    });
  });

  describe('Anchor Configuration', () => {
    it('should reject request for unconfigured anchor', async () => {
      const middleware = createWebhookVerificationMiddleware({
        getAnchorSecret: async () => null, // No secret for this anchor
      });
      
      app = createTestApp(TEST_SECRET, middleware);
      
      const payload = JSON.stringify({ event: 'test' });
      
      const response = await request(app)
        .post('/webhooks/test')
        .set('Content-Type', 'application/json')
        .set('x-anchor-id', 'unknown-anchor')
        .send(payload);
      
      expect(response.status).toBe(500); // Or 401, depending on implementation
      expect(response.body.code).toBe('ANCHOR_NOT_CONFIGURED');
    });
  });
});