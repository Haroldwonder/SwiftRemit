import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KycExpiryNotifier } from '../kyc-expiry-notifier';
import { KycUpsertService } from '../kyc-upsert-service';

// ── axios mock ────────────────────────────────────────────────────────────────
vi.mock('axios');
import axios from 'axios';

// ── database mock ─────────────────────────────────────────────────────────────
vi.mock('../database', () => ({
  getAnchorKycConfigs: vi.fn().mockResolvedValue([
    {
      anchor_id: 'anchor-1',
      kyc_server_url: 'https://kyc.anchor1.com',
      auth_token: 'tok',
      polling_interval_minutes: 60,
      enabled: true,
    },
  ]),
  getUsersNeedingKycCheck: vi.fn().mockResolvedValue([]),
  saveUserKycStatus: vi.fn(),
  getApprovedUsers: vi.fn().mockResolvedValue([]),
  getPool: vi.fn(() => ({ query: vi.fn().mockResolvedValue({ rows: [] }) })),
  saveAnchorPollFailure: vi.fn(),
  getAnchorKycConfigs: vi.fn().mockResolvedValue([
    {
      anchor_id: 'anchor-1',
      kyc_server_url: 'https://kyc.anchor1.com',
      auth_token: 'tok',
      polling_interval_minutes: 60,
      enabled: true,
    },
  ]),
}));

vi.mock('../stellar', () => ({ updateKycStatusOnChain: vi.fn() }));
vi.mock('../stellar-kyc', () => ({ setKycApprovedOnChain: vi.fn().mockResolvedValue({ success: true }) }));

// ── helpers ───────────────────────────────────────────────────────────────────

function makePool(queryImpl?: (sql: string, params?: any[]) => any) {
  const query = vi.fn().mockImplementation((sql: string, params?: any[]) => {
    if (queryImpl) return queryImpl(sql, params);
    return Promise.resolve({ rows: [] });
  });
  return { query, connect: vi.fn() } as any;
}

function makeStore() {
  return { getSubscribersForEvent: vi.fn().mockResolvedValue([]) } as any;
}

// ── KycExpiryNotifier tests ───────────────────────────────────────────────────

describe('KycExpiryNotifier — re-verification flow (#862)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls SEP-12 PUT /customer after sending the expiry warning', async () => {
    (axios.put as any) = vi.fn().mockResolvedValue({ status: 200 });

    const pool = makePool(sql => {
      // Return one expiring user
      if (sql.includes('FROM user_kyc_status')) {
        return Promise.resolve({
          rows: [{ user_id: 'user-1', anchor_id: 'anchor-1', expires_at: new Date(Date.now() + 3 * 86400_000) }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const notifier = new KycExpiryNotifier(pool, makeStore());
    await notifier.run();

    expect(axios.put).toHaveBeenCalledWith(
      'https://kyc.anchor1.com/customer',
      { account: 'user-1' },
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) })
    );
  });

  it('sets status to re_verification_pending in DB after SEP-12 call', async () => {
    (axios.put as any) = vi.fn().mockResolvedValue({ status: 200 });

    const updateCalls: { sql: string; params: any[] }[] = [];
    const pool = makePool((sql, params) => {
      if (sql.includes('FROM user_kyc_status')) {
        return Promise.resolve({
          rows: [{ user_id: 'user-1', anchor_id: 'anchor-1', expires_at: new Date(Date.now() + 3 * 86400_000) }],
        });
      }
      if (sql.includes('UPDATE user_kyc_status')) {
        updateCalls.push({ sql, params: params ?? [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const notifier = new KycExpiryNotifier(pool, makeStore());
    await notifier.run();

    expect(updateCalls.length).toBeGreaterThan(0);
    const updateCall = updateCalls[0];
    expect(updateCall.sql).toContain("'re_verification_pending'");
    expect(updateCall.params).toContain('user-1');
    expect(updateCall.params).toContain('anchor-1');
  });

  it('does not throw if SEP-12 call fails — continues gracefully', async () => {
    (axios.put as any) = vi.fn().mockRejectedValue(new Error('network error'));

    const pool = makePool(sql => {
      if (sql.includes('FROM user_kyc_status')) {
        return Promise.resolve({
          rows: [{ user_id: 'user-1', anchor_id: 'anchor-1', expires_at: new Date(Date.now() + 3 * 86400_000) }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const notifier = new KycExpiryNotifier(pool, makeStore());
    await expect(notifier.run()).resolves.not.toThrow();
  });
});

// ── Transfer guard / KycUpsertService tests ───────────────────────────────────

describe('KycUpsertService.getStatusForUser — re_verification_pending (#862)', () => {
  it('blocks transfer when any anchor is re_verification_pending', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { anchor_id: 'anchor-1', kyc_status: 're_verification_pending', kyc_level: null, verified_at: new Date(), expires_at: null, rejection_reason: null },
        ],
      }),
    } as any;

    const svc = new KycUpsertService(pool);
    const status = await svc.getStatusForUser('user-1');

    expect(status.can_transfer).toBe(false);
    expect(status.reason).toBe('re_verification_pending');
  });

  it('blocks transfer even when another anchor is approved but one is re_verification_pending', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { anchor_id: 'anchor-1', kyc_status: 'approved', kyc_level: null, verified_at: new Date(), expires_at: null, rejection_reason: null },
          { anchor_id: 'anchor-2', kyc_status: 're_verification_pending', kyc_level: null, verified_at: new Date(), expires_at: null, rejection_reason: null },
        ],
      }),
    } as any;

    const svc = new KycUpsertService(pool);
    const status = await svc.getStatusForUser('user-1');

    expect(status.can_transfer).toBe(false);
    expect(status.reason).toBe('re_verification_pending');
  });

  it('resumes transfer when anchor re-approves (status set back to approved)', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { anchor_id: 'anchor-1', kyc_status: 'approved', kyc_level: null, verified_at: new Date(), expires_at: new Date(Date.now() + 86400_000), rejection_reason: null },
        ],
      }),
    } as any;

    const svc = new KycUpsertService(pool);
    const status = await svc.getStatusForUser('user-1');

    expect(status.can_transfer).toBe(true);
  });
});
