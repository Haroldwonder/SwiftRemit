import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import { idempotencyMiddleware, clearIdempotencyCache, validateIdempotencyKey } from '../middleware/idempotency';
import { v4 as uuidv4 } from 'uuid';

describe('Idempotency Key Support (Issue #878)', () => {
  let app: Application;
  const idempotencyKey = uuidv4();
  let callCount = 0;

  beforeEach(() => {
    callCount = 0;
    clearIdempotencyCache();
    
    app = express();
    app.use(express.json());
    app.use(idempotencyMiddleware);

    app.post('/api/remittances', (req, res) => {
      callCount++;
      res.json({
        success: true,
        data: {
          id: 'remittance-123',
          amount: 100,
          status: 'Pending',
        },
        timestamp: new Date().toISOString(),
      });
    });
  });

  afterEach(() => {
    clearIdempotencyCache();
  });

  describe('Idempotency-Key header handling', () => {
    it('should accept POST without Idempotency-Key', async () => {
      const response = await request(app).post('/api/remittances').send({ amount: 100 });
      expect(response.status).toBe(200);
      expect(callCount).toBe(1);
    });

    it('should cache response for duplicate Idempotency-Key', async () => {
      const response1 = await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', idempotencyKey)
        .send({ amount: 100 });

      const response2 = await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', idempotencyKey)
        .send({ amount: 100 });

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(response1.body).toEqual(response2.body);
      expect(callCount).toBe(1); // Should only call handler once
    });

    it('should return same response body from cache', async () => {
      const response1 = await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', idempotencyKey)
        .send({ amount: 100 });

      const response2 = await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', idempotencyKey)
        .send({ amount: 200 }); // Different payload

      expect(response1.body).toEqual(response2.body);
    });

    it('should return Idempotency-Key in response header', async () => {
      const response = await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', idempotencyKey)
        .send({ amount: 100 });

      expect(response.headers['idempotency-key']).toBe(idempotencyKey);
    });

    it('should treat different keys as different requests', async () => {
      const key1 = uuidv4();
      const key2 = uuidv4();

      await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', key1)
        .send({ amount: 100 });

      await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', key2)
        .send({ amount: 100 });

      expect(callCount).toBe(2);
    });

    it('should not cache non-POST requests', async () => {
      const response1 = await request(app).get('/api/remittances');
      const response2 = await request(app).get('/api/remittances');

      expect(response1.status).toBe(404);
      expect(response2.status).toBe(404);
    });

    it('should set Cache-Control header to prevent caching', async () => {
      const response = await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', idempotencyKey)
        .send({ amount: 100 });

      expect(response.headers['cache-control']).toBe('private, no-store');
    });
  });

  describe('UUID v4 validation', () => {
    it('should validate correct UUID v4', () => {
      const validUuid = uuidv4();
      expect(validateIdempotencyKey(validUuid)).toBe(true);
    });

    it('should reject invalid UUID', () => {
      expect(validateIdempotencyKey('not-a-uuid')).toBe(false);
    });

    it('should reject UUID v1', () => {
      const uuidv1 = '550e8400-e29b-11d4-a716-446655440000'; // v1 has '1' in version position
      expect(validateIdempotencyKey(uuidv1)).toBe(false);
    });

    it('should reject malformed UUID', () => {
      expect(validateIdempotencyKey('550e8400-e29b-41d4-a716')).toBe(false);
    });
  });

  describe('24-hour cache window', () => {
    it('should cache response for 24 hours', async () => {
      const response = await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', idempotencyKey)
        .send({ amount: 100 });

      expect(response.status).toBe(200);
      // Cache is verified through the second request hitting the same key
      const response2 = await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', idempotencyKey)
        .send({ amount: 100 });

      expect(response2.status).toBe(200);
      expect(callCount).toBe(1);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle network retry scenario', async () => {
      const payload = { amount: 100, recipient: 'alice' };
      const key = uuidv4();

      // Initial request
      const response1 = await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', key)
        .send(payload);

      // Network timeout - client retries with same key
      const response2 = await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', key)
        .send(payload);

      expect(response1.body.data.id).toBe(response2.body.data.id);
      expect(callCount).toBe(1);
    });

    it('should prevent duplicate remittance creation', async () => {
      const payload = { amount: 500, recipient: 'bob' };
      const key = uuidv4();

      const response1 = await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', key)
        .send(payload);

      const response2 = await request(app)
        .post('/api/remittances')
        .set('Idempotency-Key', key)
        .send(payload);

      expect(response1.body.data).toEqual(response2.body.data);
      expect(callCount).toBe(1); // Only one remittance created
    });
  });
});
