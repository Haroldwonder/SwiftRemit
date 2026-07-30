import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KycExpiryNotifier } from '../kyc-expiry-notifier';

// ── Mocks ──────────────────────────────────────────────────────────────────────

// Mock database module — getAnchorKycConfigs is the only function used by KycExpiryNotifier
vi.mock('../database', () => ({
  getAnchorKycConfigs: vi.fn().mockResolvedValue([]),
}));

// Mock axios so no real HTTP calls go out
vi.mock('axios', () => ({
  default: { put: vi.fn().mockResolvedValue({ status: 200 }) },
  put: vi.fn().mockResolvedValue({ status: 200 }),
}));

import * as database from '../database';
import axios from 'axios';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeStore() {
  return { getSubscribers: vi.fn().mockResolvedValue([]) } as any;
}

function makeDispatcher() {
  return { dispatch: vi.fn().mockResolvedValue(undefined) };
}

// Patch the WebhookDispatcher constructor so we control dispatch in tests
vi.mock('../webhooks/dispatcher', () => ({
  WebhookDispatcher: vi.fn().mockImplementation(() => makeDispatcher()),
}));

import { WebhookDispatcher } from '../webhooks/dispatcher';

function poolWithRows(rows: object[]) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('KycExpiryNotifier.run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when there are no expiring records', async () => {
    const pool       = poolWithRows([]);
    const notifier   = new KycExpiryNotifier(pool as any, makeStore());
    const dispatched = await notifier.run();
    expect(dispatched).toBe(0);
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it('dispatches one notification per expiring record', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const rows = [
      { user_id: 'u1', anchor_id: 'anchor-1', expires_at: tomorrow },
      { user_id: 'u2', anchor_id: 'anchor-2', expires_at: tomorrow },
    ];

    const pool     = poolWithRows(rows);
    const notifier = new KycExpiryNotifier(pool as any, makeStore());

    // getAnchorKycConfigs returns no config → initiateReVerification skips axios call
    vi.mocked(database.getAnchorKycConfigs).mockResolvedValue([]);

    const dispatched = await notifier.run();
    expect(dispatched).toBe(2);
  });

  it('includes renewal_url in the dispatch payload', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const pool     = poolWithRows([{ user_id: 'u1', anchor_id: 'a1', expires_at: tomorrow }]);
    const notifier = new KycExpiryNotifier(pool as any, makeStore());
    vi.mocked(database.getAnchorKycConfigs).mockResolvedValue([]);

    await notifier.run();

    const dispatchMock = vi.mocked(WebhookDispatcher).mock.results[0].value.dispatch;
    const payload = dispatchMock.mock.calls[0][1];
    expect(payload.data.renewal_url).toContain('u1');
    expect(payload.data.renewal_url).toContain('a1');
  });

  it('continues processing remaining records when one dispatch fails', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const rows = [
      { user_id: 'fail-user', anchor_id: 'a1', expires_at: tomorrow },
      { user_id: 'ok-user',   anchor_id: 'a2', expires_at: tomorrow },
    ];
    const pool     = poolWithRows(rows);
    const notifier = new KycExpiryNotifier(pool as any, makeStore());
    vi.mocked(database.getAnchorKycConfigs).mockResolvedValue([]);

    const dispatchMock = vi.mocked(WebhookDispatcher).mock.results[0].value.dispatch;
    dispatchMock
      .mockRejectedValueOnce(new Error('dispatch failed'))
      .mockResolvedValueOnce(undefined);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispatched = await notifier.run();
    // Only the second one succeeded
    expect(dispatched).toBe(1);
    errorSpy.mockRestore();
  });

  it('returns 0 and logs error when DB query fails on all retries', async () => {
    const pool     = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    const notifier = new KycExpiryNotifier(pool as any, makeStore());
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Set a very short retry delay so the test doesn't time out
    const dispatched = await notifier.run();
    expect(dispatched).toBe(0);
    errorSpy.mockRestore();
  }, 15_000);
});

describe('KycExpiryNotifier.initiateReVerification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips the axios call when no anchor config is found', async () => {
    vi.mocked(database.getAnchorKycConfigs).mockResolvedValue([]);
    const pool     = { query: vi.fn() };
    const notifier = new KycExpiryNotifier(pool as any, makeStore());

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifier.initiateReVerification('u1', 'unknown-anchor');

    expect(vi.mocked(axios).put ?? (axios as any).put).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('calls SEP-12 PUT /customer and updates DB status', async () => {
    vi.mocked(database.getAnchorKycConfigs).mockResolvedValue([
      {
        anchor_id:                 'anchor-1',
        kyc_server_url:            'https://kyc.example.com',
        auth_token:                'tok',
        polling_interval_minutes:  60,
        enabled:                   true,
      },
    ]);

    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const notifier = new KycExpiryNotifier(pool as any, makeStore());

    const axiosPut = vi.mocked((axios as any).put ?? axios.put);
    axiosPut.mockResolvedValue({ status: 200 });

    await notifier.initiateReVerification('u1', 'anchor-1');

    expect(axiosPut).toHaveBeenCalledWith(
      'https://kyc.example.com/customer',
      expect.objectContaining({ account: 'u1' }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }),
    );

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('re_verification_pending'),
      ['u1', 'anchor-1'],
    );
  });
});
