/**
 * Receipt endpoint authorization tests (SR-048).
 *
 * Tests for the GET /:id/receipt endpoint covering ownership enforcement,
 * admin bypass, 404 handling, and service availability (503).
 *
 * SR-048 hardened this route against IDOR (Insecure Direct Object Reference)
 * by sourcing identity from the verified access token, never from client headers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Router } from 'express';
import { createRemittancesRouter } from '../routes/remittances';
import { RemittanceStore } from '../db/remittanceStore';
import { requireAuth } from '../middleware/auth';
import {
  TEST_JWT_SECRET,
  bearer,
  makeAccessToken,
  useTestJwtSecret,
} from './helpers/authTestUtils';

interface MockRemittance {
  id: string;
  sender_id: string;
  agent: string;
  amount: number;
  fee: number;
  status: string;
  created_at: string;
  updated_at: string;
}

class MockRemittanceStore implements Partial<RemittanceStore> {
  private remittances: Map<string, MockRemittance> = new Map();

  async getById(id: string): Promise<MockRemittance | null> {
    return this.remittances.get(id) || null;
  }

  addRemittance(remittance: MockRemittance) {
    this.remittances.set(remittance.id, remittance);
  }

  clear() {
    this.remittances.clear();
  }
}

beforeEach(() => {
  useTestJwtSecret();
  process.env.NODE_ENV = 'test';
});

describe('SR-048 — Receipt endpoint authorization', () => {
  describe('ownership enforcement', () => {
    it('returns 403 when a non-admin user requests another user\'s receipt', async () => {
      const mockStore = new MockRemittanceStore();
      mockStore.addRemittance({
        id: 'remit-123',
        sender_id: 'user-alice',
        agent: 'agent-bob',
        amount: 1000000,
        fee: 2500,
        status: 'Completed',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      const app = express();
      app.use(express.json());
      app.use(
        '/api/remittances',
        createRemittancesRouter({ remittanceStore: mockStore as RemittanceStore })
      );

      // User charlie tries to download alice's receipt
      const charlieToken = makeAccessToken('user-charlie', { role: 'user' });

      const res = await request(app)
        .get('/api/remittances/remit-123/receipt')
        .set('Authorization', `Bearer ${charlieToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('FORBIDDEN');
      expect(res.body.error?.message).toContain('do not have access');
    });

    it('returns 200 when a user requests their own receipt', async () => {
      const mockStore = new MockRemittanceStore();
      mockStore.addRemittance({
        id: 'remit-123',
        sender_id: 'user-alice',
        agent: 'agent-bob',
        amount: 1000000,
        fee: 2500,
        status: 'Completed',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      const app = express();
      app.use(express.json());
      app.use(
        '/api/remittances',
        createRemittancesRouter({ remittanceStore: mockStore as RemittanceStore })
      );

      // Alice requests her own receipt
      const aliceToken = makeAccessToken('user-alice', { role: 'user' });

      const res = await request(app)
        .get('/api/remittances/remit-123/receipt')
        .set('Authorization', `Bearer ${aliceToken}`);

      // Should succeed and return PDF (we can't easily validate PDF in tests,
      // but we check for success and PDF headers)
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
    });
  });

  describe('admin bypass', () => {
    it('allows admin to download any user\'s receipt without ownership check', async () => {
      const mockStore = new MockRemittanceStore();
      mockStore.addRemittance({
        id: 'remit-456',
        sender_id: 'user-bob',
        agent: 'agent-charlie',
        amount: 2000000,
        fee: 5000,
        status: 'Completed',
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      });

      const app = express();
      app.use(express.json());
      app.use(
        '/api/remittances',
        createRemittancesRouter({ remittanceStore: mockStore as RemittanceStore })
      );

      // Admin requests bob's receipt (different user)
      const adminToken = makeAccessToken('admin-alice', { role: 'admin' });

      const res = await request(app)
        .get('/api/remittances/remit-456/receipt')
        .set('Authorization', `Bearer ${adminToken}`);

      // Admin should succeed (bypass ownership check)
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
    });
  });

  describe('404 handling', () => {
    it('returns 404 when remittance does not exist', async () => {
      const mockStore = new MockRemittanceStore();
      // No remittances added

      const app = express();
      app.use(express.json());
      app.use(
        '/api/remittances',
        createRemittancesRouter({ remittanceStore: mockStore as RemittanceStore })
      );

      const aliceToken = makeAccessToken('user-alice', { role: 'user' });

      const res = await request(app)
        .get('/api/remittances/nonexistent-id/receipt')
        .set('Authorization', `Bearer ${aliceToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('NOT_FOUND');
      expect(res.body.error?.message).toContain('not found');
    });
  });

  describe('service availability', () => {
    it('returns 503 when remittanceStore is not configured', async () => {
      const app = express();
      app.use(express.json());
      // Create router without remittanceStore (undefined)
      app.use('/api/remittances', createRemittancesRouter());

      const aliceToken = makeAccessToken('user-alice', { role: 'user' });

      const res = await request(app)
        .get('/api/remittances/remit-123/receipt')
        .set('Authorization', `Bearer ${aliceToken}`);

      expect(res.status).toBe(503);
      expect(res.body.error?.code).toBe('SERVICE_UNAVAILABLE');
      expect(res.body.error?.message).toContain('store not configured');
    });
  });
});
