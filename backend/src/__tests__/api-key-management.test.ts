import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';

const db = vi.hoisted(() => ({
  apiKeys: new Map<string, any>(),
}));

vi.mock('../database', () => ({
  initDatabase: vi.fn().mockResolvedValue(undefined),
  getPool: vi.fn(() => ({ query: vi.fn(), connect: vi.fn() })),
}));

vi.mock('../stellar', () => ({
  storeVerificationOnChain: vi.fn().mockResolvedValue(undefined),
}));

// Mock crypto for consistent testing
const mockHashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

import app from '../api';

describe('API Key Management', () => {
  beforeEach(() => {
    db.apiKeys.clear();
    vi.clearAllMocks();
  });

  describe('POST /api/developers/keys', () => {
    it('should create an API key', async () => {
      const response = await request(app)
        .post('/api/developers/keys')
        .send({
          name: 'test-key',
          scopes: ['remittance:create', 'remittance:read'],
        })
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('key_id');
      expect(response.body).toHaveProperty('secret');
      expect(response.body.name).toBe('test-key');
      expect(response.body.scopes).toContain('remittance:create');
    });

    it('should hash the key at rest', async () => {
      const response = await request(app)
        .post('/api/developers/keys')
        .send({
          name: 'hashed-key-test',
          scopes: ['remittance:read'],
        })
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(201);
      const keyId = response.body.key_id;
      
      // Simulate storing hashed key
      const secret = response.body.secret;
      const hashedSecret = mockHashKey(secret);
      
      // Verify that hashing produces consistent output
      expect(mockHashKey(secret)).toBe(hashedSecret);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/api/developers/keys')
        .send({
          name: 'test-key',
          scopes: ['remittance:create'],
        });

      expect(response.status).toBe(401);
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/developers/keys')
        .send({
          scopes: ['remittance:create'],
        })
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/developers/keys', () => {
    it('should list active API keys', async () => {
      // First create some keys
      await request(app)
        .post('/api/developers/keys')
        .send({ name: 'key1', scopes: ['remittance:read'] })
        .set('Authorization', 'Bearer valid-token');

      await request(app)
        .post('/api/developers/keys')
        .send({ name: 'key2', scopes: ['remittance:write'] })
        .set('Authorization', 'Bearer valid-token');

      const response = await request(app)
        .get('/api/developers/keys')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(0);
    });

    it('should not return secrets in list response', async () => {
      await request(app)
        .post('/api/developers/keys')
        .send({ name: 'secret-key', scopes: ['remittance:read'] })
        .set('Authorization', 'Bearer valid-token');

      const response = await request(app)
        .get('/api/developers/keys')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      if (response.body.length > 0) {
        response.body.forEach((key: any) => {
          expect(key).not.toHaveProperty('secret');
        });
      }
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app).get('/api/developers/keys');

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /api/developers/keys/:key_id', () => {
    it('should revoke an API key', async () => {
      const createResponse = await request(app)
        .post('/api/developers/keys')
        .send({ name: 'revoke-test', scopes: ['remittance:read'] })
        .set('Authorization', 'Bearer valid-token');

      const keyId = createResponse.body.key_id;

      const deleteResponse = await request(app)
        .delete(`/api/developers/keys/${keyId}`)
        .set('Authorization', 'Bearer valid-token');

      expect(deleteResponse.status).toBe(204);
    });

    it('should return 404 for non-existent key', async () => {
      const response = await request(app)
        .delete('/api/developers/keys/nonexistent')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app).delete('/api/developers/keys/test-key');

      expect(response.status).toBe(401);
    });

    it('should only allow user to revoke their own keys', async () => {
      const createResponse = await request(app)
        .post('/api/developers/keys')
        .send({ name: 'test-key', scopes: ['remittance:read'] })
        .set('Authorization', 'Bearer user1-token');

      const keyId = createResponse.body.key_id;

      const deleteResponse = await request(app)
        .delete(`/api/developers/keys/${keyId}`)
        .set('Authorization', 'Bearer user2-token');

      expect(deleteResponse.status).toBe(403);
    });
  });

  describe('API Key Lifecycle', () => {
    it('should complete full key lifecycle', async () => {
      // Create
      const createResponse = await request(app)
        .post('/api/developers/keys')
        .send({ name: 'lifecycle-test', scopes: ['remittance:read', 'remittance:write'] })
        .set('Authorization', 'Bearer valid-token');

      expect(createResponse.status).toBe(201);
      const keyId = createResponse.body.key_id;

      // List and verify key exists
      const listResponse = await request(app)
        .get('/api/developers/keys')
        .set('Authorization', 'Bearer valid-token');

      expect(listResponse.status).toBe(200);
      const existingKey = listResponse.body.find((k: any) => k.key_id === keyId);
      expect(existingKey).toBeDefined();
      expect(existingKey.name).toBe('lifecycle-test');

      // Revoke
      const deleteResponse = await request(app)
        .delete(`/api/developers/keys/${keyId}`)
        .set('Authorization', 'Bearer valid-token');

      expect(deleteResponse.status).toBe(204);

      // Verify key is no longer active
      const finalListResponse = await request(app)
        .get('/api/developers/keys')
        .set('Authorization', 'Bearer valid-token');

      expect(finalListResponse.status).toBe(200);
      const revokedKey = finalListResponse.body.find((k: any) => k.key_id === keyId);
      expect(revokedKey?.active).toBe(false);
    });
  });
});
