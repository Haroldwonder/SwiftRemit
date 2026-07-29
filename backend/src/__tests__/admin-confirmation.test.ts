import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminConfirmationService, HighRiskOperation } from '../admin-confirmation';

// ── DB mock factory ────────────────────────────────────────────────────────────

function makePool(rows: Record<string, unknown>[][] = []) {
  let callIndex = 0;
  return {
    query: vi.fn(async () => {
      const result = rows[callIndex] ?? [];
      callIndex++;
      return { rows: result, rowCount: result.length };
    }),
  };
}

// ── Shared test data ───────────────────────────────────────────────────────────

const OP: HighRiskOperation = 'withdraw_fees';
const ADMIN_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1';
const ADMIN_B = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2';

const futureExpiry = new Date(Date.now() + 3_600_000);
const pastExpiry   = new Date(Date.now() - 1000);

function pendingAction(overrides: Record<string, unknown> = {}) {
  return {
    id:           'test-uuid',
    operation:    OP,
    initiated_by: ADMIN_A,
    params:       {},
    expires_at:   futureExpiry,
    confirmed_by: null,
    confirmed_at: null,
    created_at:   new Date(),
    ...overrides,
  };
}

// ── initTable ─────────────────────────────────────────────────────────────────

describe('AdminConfirmationService.initTable', () => {
  it('runs CREATE TABLE IF NOT EXISTS without throwing', async () => {
    const pool = makePool();
    const svc = new AdminConfirmationService(pool as any);
    await expect(svc.initTable()).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledOnce();
  });
});

// ── initiate ──────────────────────────────────────────────────────────────────

describe('AdminConfirmationService.initiate', () => {
  it('returns the new pending action', async () => {
    const action = pendingAction();
    // initiate calls: INSERT returning + audit INSERT
    const pool = makePool([[action], []]);
    const svc = new AdminConfirmationService(pool as any);

    const result = await svc.initiate(OP, ADMIN_A, { amount: '100' });

    expect(result.operation).toBe(OP);
    expect(result.initiated_by).toBe(ADMIN_A);
    expect(result.confirmed_by).toBeNull();
  });

  it('writes an audit log entry', async () => {
    const action = pendingAction();
    const pool = makePool([[action], []]);
    const svc = new AdminConfirmationService(pool as any);
    await svc.initiate(OP, ADMIN_A, {});
    // Second query is the audit INSERT
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});

// ── confirm ───────────────────────────────────────────────────────────────────

describe('AdminConfirmationService.confirm', () => {
  it('confirms a pending action successfully', async () => {
    const action      = pendingAction();
    const confirmed   = pendingAction({ confirmed_by: ADMIN_B, confirmed_at: new Date() });
    // get → UPDATE returning → audit INSERT
    const pool = makePool([[action], [confirmed], []]);
    const svc  = new AdminConfirmationService(pool as any);

    const result = await svc.confirm('test-uuid', ADMIN_B);

    expect(result.confirmed_by).toBe(ADMIN_B);
  });

  it('throws when action does not exist', async () => {
    const pool = makePool([[]]); // get returns empty
    const svc  = new AdminConfirmationService(pool as any);

    await expect(svc.confirm('no-such-id', ADMIN_B)).rejects.toThrow('not found');
  });

  it('throws when action is already confirmed', async () => {
    const action = pendingAction({ confirmed_by: ADMIN_B });
    const pool   = makePool([[action]]);
    const svc    = new AdminConfirmationService(pool as any);

    await expect(svc.confirm('test-uuid', ADMIN_A)).rejects.toThrow('already confirmed');
  });

  it('throws when action has expired', async () => {
    const action = pendingAction({ expires_at: pastExpiry });
    const pool   = makePool([[action]]);
    const svc    = new AdminConfirmationService(pool as any);

    await expect(svc.confirm('test-uuid', ADMIN_B)).rejects.toThrow('expired');
  });

  it('throws when the same admin tries to confirm their own action', async () => {
    const action = pendingAction({ initiated_by: ADMIN_A });
    const pool   = makePool([[action]]);
    const svc    = new AdminConfirmationService(pool as any);

    await expect(svc.confirm('test-uuid', ADMIN_A)).rejects.toThrow('cannot confirm');
  });
});

// ── get ───────────────────────────────────────────────────────────────────────

describe('AdminConfirmationService.get', () => {
  it('returns the action when found', async () => {
    const action = pendingAction();
    const pool   = makePool([[action]]);
    const svc    = new AdminConfirmationService(pool as any);

    const result = await svc.get('test-uuid');
    expect(result?.id).toBe('test-uuid');
  });

  it('returns null when not found', async () => {
    const pool = makePool([[]]);
    const svc  = new AdminConfirmationService(pool as any);
    expect(await svc.get('missing')).toBeNull();
  });
});

// ── listPending ───────────────────────────────────────────────────────────────

describe('AdminConfirmationService.listPending', () => {
  it('returns unconfirmed non-expired actions', async () => {
    const actions = [pendingAction({ id: 'a' }), pendingAction({ id: 'b' })];
    const pool    = makePool([actions]);
    const svc     = new AdminConfirmationService(pool as any);

    const result = await svc.listPending();
    expect(result).toHaveLength(2);
    expect(result.every((a) => a.confirmed_by === null)).toBe(true);
  });

  it('returns empty array when no pending actions', async () => {
    const pool = makePool([[]]);
    const svc  = new AdminConfirmationService(pool as any);
    expect(await svc.listPending()).toEqual([]);
  });
});

// ── purgeExpired ──────────────────────────────────────────────────────────────

describe('AdminConfirmationService.purgeExpired', () => {
  it('returns the number of rows deleted', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rowCount: 3 }) };
    const svc  = new AdminConfirmationService(pool as any);
    expect(await svc.purgeExpired()).toBe(3);
  });

  it('returns 0 when nothing was deleted', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rowCount: null }) };
    const svc  = new AdminConfirmationService(pool as any);
    expect(await svc.purgeExpired()).toBe(0);
  });
});
