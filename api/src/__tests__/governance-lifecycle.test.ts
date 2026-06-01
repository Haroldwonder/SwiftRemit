import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ─── Shared in-memory state (vi.hoisted so vi.mock factory can close over it) ─

const { pendingActions } = vi.hoisted(() => ({
  pendingActions: new Map<string, Record<string, unknown>>(),
}));

// ─── Mock AdminConfirmationService with a faithful in-memory implementation ───

vi.mock('../../../backend/src/admin-confirmation', () => {
  let seq = 0;

  class MockAdminConfirmationService {
    async initTable() {}

    async initiate(
      operation: string,
      initiatedBy: string,
      params: Record<string, unknown>
    ) {
      const id = `action-${++seq}`;
      const action = {
        id,
        operation,
        initiated_by: initiatedBy,
        params,
        expires_at: new Date(Date.now() + 3_600_000),
        confirmed_by: null,
        confirmed_at: null,
        created_at: new Date(),
      };
      pendingActions.set(id, action);
      return action;
    }

    async confirm(actionId: string, confirmingAdmin: string) {
      const action = pendingActions.get(actionId);
      if (!action) throw new Error(`Pending action not found: ${actionId}`);
      if (action.confirmed_by) throw new Error('Action already confirmed');
      if (new Date() > (action.expires_at as Date))
        throw new Error('Pending action has expired');
      if (action.initiated_by === confirmingAdmin)
        throw new Error('The initiating admin cannot confirm their own action');
      action.confirmed_by = confirmingAdmin;
      action.confirmed_at = new Date();
      return action;
    }

    async get(id: string) {
      return pendingActions.get(id) ?? null;
    }

    async listPending() {
      const now = new Date();
      return [...pendingActions.values()].filter(
        (a) => !a.confirmed_by && (a.expires_at as Date) > now
      );
    }

    async purgeExpired() {
      const now = new Date();
      let count = 0;
      for (const [id, a] of pendingActions) {
        if (!a.confirmed_by && (a.expires_at as Date) <= now) {
          pendingActions.delete(id);
          count++;
        }
      }
      return count;
    }
  }

  return { AdminConfirmationService: MockAdminConfirmationService };
});

// ─── Env vars must be set before app is imported ──────────────────────────────

process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
process.env.ADMIN_API_KEY = 'governance-test-key';

import { createApp } from '../app';

const ADMIN_KEY = 'governance-test-key';
const ADMIN_1 = 'GADMIN1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const ADMIN_2 = 'GADMIN2XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

const app = createApp();

// ─────────────────────────────────────────────────────────────────────────────

describe('Governance proposal lifecycle — integration', () => {
  beforeEach(() => {
    pendingActions.clear();
  });

  // ── Proposal initiation ────────────────────────────────────────────────────

  describe('proposal initiation', () => {
    it('admin can initiate a high-risk governance proposal', async () => {
      const res = await request(app)
        .post('/api/admin/actions')
        .set('x-api-key', ADMIN_KEY)
        .send({ operation: 'update_fee', initiated_by: ADMIN_1, params: { fee_bps: 300 } });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.operation).toBe('update_fee');
      expect(res.body.data.initiated_by).toBe(ADMIN_1);
      expect(res.body.data.confirmed_by).toBeNull();
      expect(res.body.data.id).toBeDefined();
    });

    it('rejects proposal without admin authentication', async () => {
      const res = await request(app)
        .post('/api/admin/actions')
        .send({ operation: 'update_fee', initiated_by: ADMIN_1 });

      expect(res.status).toBe(401);
    });

    it('rejects proposal with an invalid operation type', async () => {
      const res = await request(app)
        .post('/api/admin/actions')
        .set('x-api-key', ADMIN_KEY)
        .send({ operation: 'delete_everything', initiated_by: ADMIN_1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_OPERATION');
    });

    it('rejects proposal when initiated_by is missing', async () => {
      const res = await request(app)
        .post('/api/admin/actions')
        .set('x-api-key', ADMIN_KEY)
        .send({ operation: 'update_fee' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_FIELD');
    });
  });

  // ── Multi-admin voting ─────────────────────────────────────────────────────

  describe('multi-admin voting', () => {
    it('second admin can vote to confirm a pending proposal', async () => {
      const proposeRes = await request(app)
        .post('/api/admin/actions')
        .set('x-api-key', ADMIN_KEY)
        .send({ operation: 'withdraw_fees', initiated_by: ADMIN_1, params: {} });

      expect(proposeRes.status).toBe(201);
      const actionId = proposeRes.body.data.id;

      const confirmRes = await request(app)
        .post(`/api/admin/actions/${actionId}/confirm`)
        .set('x-api-key', ADMIN_KEY)
        .send({ confirmed_by: ADMIN_2 });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.success).toBe(true);
      expect(confirmRes.body.data.confirmed_by).toBe(ADMIN_2);
      expect(confirmRes.body.data.confirmed_at).not.toBeNull();
    });

    it('the initiating admin cannot vote on their own proposal (self-confirm blocked)', async () => {
      const proposeRes = await request(app)
        .post('/api/admin/actions')
        .set('x-api-key', ADMIN_KEY)
        .send({ operation: 'remove_agent', initiated_by: ADMIN_1, params: { agent: 'GXXX' } });

      expect(proposeRes.status).toBe(201);
      const actionId = proposeRes.body.data.id;

      const confirmRes = await request(app)
        .post(`/api/admin/actions/${actionId}/confirm`)
        .set('x-api-key', ADMIN_KEY)
        .send({ confirmed_by: ADMIN_1 });

      expect(confirmRes.status).toBe(409);
    });

    it('lists all proposals pending a second admin vote', async () => {
      await request(app)
        .post('/api/admin/actions')
        .set('x-api-key', ADMIN_KEY)
        .send({ operation: 'update_fee', initiated_by: ADMIN_1, params: { fee_bps: 200 } });

      await request(app)
        .post('/api/admin/actions')
        .set('x-api-key', ADMIN_KEY)
        .send({ operation: 'withdraw_fees', initiated_by: ADMIN_2, params: {} });

      const listRes = await request(app)
        .get('/api/admin/actions')
        .set('x-api-key', ADMIN_KEY);

      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
      expect(listRes.body.data).toHaveLength(2);
    });

    it('rejects confirm without admin authentication', async () => {
      const proposeRes = await request(app)
        .post('/api/admin/actions')
        .set('x-api-key', ADMIN_KEY)
        .send({ operation: 'update_fee', initiated_by: ADMIN_1, params: {} });

      const actionId = proposeRes.body.data.id;

      const confirmRes = await request(app)
        .post(`/api/admin/actions/${actionId}/confirm`)
        .send({ confirmed_by: ADMIN_2 });

      expect(confirmRes.status).toBe(401);
    });
  });

  // ── Timelock enforcement ───────────────────────────────────────────────────

  describe('timelock enforcement', () => {
    it('confirmed proposal is removed from the pending list', async () => {
      const proposeRes = await request(app)
        .post('/api/admin/actions')
        .set('x-api-key', ADMIN_KEY)
        .send({ operation: 'update_fee', initiated_by: ADMIN_1, params: { fee_bps: 100 } });

      const actionId = proposeRes.body.data.id;

      await request(app)
        .post(`/api/admin/actions/${actionId}/confirm`)
        .set('x-api-key', ADMIN_KEY)
        .send({ confirmed_by: ADMIN_2 });

      const listRes = await request(app)
        .get('/api/admin/actions')
        .set('x-api-key', ADMIN_KEY);

      const stillPending = listRes.body.data.filter((a: { id: string }) => a.id === actionId);
      expect(stillPending).toHaveLength(0);
    });

    it('expired proposal cannot be confirmed (timelock window closed)', async () => {
      // Inject an already-expired proposal directly into the in-memory store
      const expiredId = 'expired-action-1';
      pendingActions.set(expiredId, {
        id: expiredId,
        operation: 'update_fee',
        initiated_by: ADMIN_1,
        params: { fee_bps: 500 },
        expires_at: new Date(Date.now() - 1_000),
        confirmed_by: null,
        confirmed_at: null,
        created_at: new Date(Date.now() - 7_200_000),
      });

      const confirmRes = await request(app)
        .post(`/api/admin/actions/${expiredId}/confirm`)
        .set('x-api-key', ADMIN_KEY)
        .send({ confirmed_by: ADMIN_2 });

      expect(confirmRes.status).toBe(409);
    });

    it('expired proposals do not appear in the pending list', async () => {
      const expiredId = 'expired-action-2';
      pendingActions.set(expiredId, {
        id: expiredId,
        operation: 'withdraw_fees',
        initiated_by: ADMIN_1,
        params: {},
        expires_at: new Date(Date.now() - 1_000),
        confirmed_by: null,
        confirmed_at: null,
        created_at: new Date(Date.now() - 7_200_000),
      });

      const listRes = await request(app)
        .get('/api/admin/actions')
        .set('x-api-key', ADMIN_KEY);

      const expired = listRes.body.data.filter((a: { id: string }) => a.id === expiredId);
      expect(expired).toHaveLength(0);
    });

    it('returns 404 for an unknown proposal ID', async () => {
      const confirmRes = await request(app)
        .post('/api/admin/actions/nonexistent-id/confirm')
        .set('x-api-key', ADMIN_KEY)
        .send({ confirmed_by: ADMIN_2 });

      expect(confirmRes.status).toBe(404);
    });
  });
});
