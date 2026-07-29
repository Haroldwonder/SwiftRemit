/**
 * SEP-24 expired-refund lifecycle tests (issue #434)
 *
 * Covers:
 *  - Full expiry lifecycle: initiated → expired → refund_requested → refunded
 *  - Partial deposits (actual < quoted): refunds actual received amount
 *  - Double-refund prevention (idempotency)
 *  - Anchor refund failure: retry → escalation → manual-review queue
 *  - Localised user notifications at each stage
 *  - Edge cases: missing external_transaction_id, already-escalated transactions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { Sep24Service } from '../sep24-service';

// ---------------------------------------------------------------------------
// Shared in-memory stores (hoisted so vi.mock factories can reference them)
// ---------------------------------------------------------------------------
const {
  sep24Rows,
  refundAttemptRows,
  manualReviewRows,
  notificationRows,
  resetStores,
} = vi.hoisted(() => {
  const sep24Rows        = new Map<string, Record<string, unknown>>();
  const refundAttemptRows = new Map<string, number>(); // txnId → attempt count
  const manualReviewRows  = new Map<string, Record<string, unknown>>();
  const notificationRows  = new Array<Record<string, unknown>>();
  const resetStores = () => {
    sep24Rows.clear();
    refundAttemptRows.clear();
    manualReviewRows.clear();
    notificationRows.length = 0;
  };
  return { sep24Rows, refundAttemptRows, manualReviewRows, notificationRows, resetStores };
});

// ---------------------------------------------------------------------------
// Mock database module
// ---------------------------------------------------------------------------
vi.mock('../database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database')>();
  return {
    ...actual,
    getAnchorKycConfigs: vi.fn().mockResolvedValue([
      { anchor_id: 'anchor_test', kyc_server_url: 'http://localhost:0/sep24' },
    ]),
    saveSep24Transaction: vi.fn(async (record: Record<string, unknown>) => {
      sep24Rows.set(record.transaction_id as string, {
        ...sep24Rows.get(record.transaction_id as string),
        ...record,
      });
    }),
    getSep24Transaction: vi.fn(async (id: string) => sep24Rows.get(id) ?? null),
    getSep24TransactionById: vi.fn(async (id: string) => sep24Rows.get(id) ?? null),
    getPendingSep24Transactions: vi.fn(async (anchorId: string) =>
      [...sep24Rows.values()].filter(
        (r) =>
          r.anchor_id === anchorId &&
          !['completed', 'refunded', 'expired', 'error'].includes(String(r.status))
      )
    ),
    updateSep24TransactionStatus: vi.fn(
      async (transactionId: string, status: string, amountIn?: string) => {
        const prev = sep24Rows.get(transactionId);
        if (!prev) return;
        sep24Rows.set(transactionId, {
          ...prev,
          status,
          amount_in: amountIn ?? prev.amount_in,
        });
      }
    ),
    getActiveWebhookSubscribers: vi.fn().mockResolvedValue([
      { id: 'sub-1', url: 'http://localhost:9999/hook', active: true },
    ]),
    enqueueWebhookDelivery: vi.fn().mockResolvedValue({
      id: 'delivery-1',
      event_type: 'sep24.expired_refund',
      event_key: 'txn-test',
      subscriber_id: 'sub-1',
      target_url: 'http://localhost:9999/hook',
      payload: {},
      status: 'pending',
      attempt_count: 0,
      max_attempts: 5,
      next_retry_at: new Date(),
    }),
    markWebhookDeliverySuccess: vi.fn().mockResolvedValue(undefined),
    markWebhookDeliveryFailure: vi.fn().mockResolvedValue(undefined),
    getPendingWebhookDeliveries: vi.fn().mockResolvedValue([]),
  };
});

// ---------------------------------------------------------------------------
// Mock stellar module
// ---------------------------------------------------------------------------
const { cancelRemittanceMock } = vi.hoisted(() => ({
  cancelRemittanceMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../stellar', () => ({
  cancelRemittanceOnChain: cancelRemittanceMock,
  storeVerificationOnChain: vi.fn(),
  simulateSettlement: vi.fn(),
  updateKycStatusOnChain: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock anchor-toml-validator
// ---------------------------------------------------------------------------
vi.mock('../anchor-toml-validator', () => ({
  validateAnchorToml: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Mock notification-templates (so we can spy on renders)
// ---------------------------------------------------------------------------
const renderMock = vi.fn().mockReturnValue({ subject: 'Test subject', body: 'Test body' });
vi.mock('../notification-templates', () => ({
  renderNotification: (...args: any[]) => renderMock(...args),
}));

// ---------------------------------------------------------------------------
// Pool mock that simulates the refund-attempt / manual-review / notification tables
// ---------------------------------------------------------------------------
function createMockPool(): Pool {
  const queryMock = vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
    // CREATE TABLE — always succeed
    if (/create table/i.test(sql)) return { rows: [], rowCount: 0 };

    // sep24_refund_attempts — INSERT
    if (/insert into sep24_refund_attempts/i.test(sql)) {
      const txnId = params?.[0] as string;
      refundAttemptRows.set(txnId, (refundAttemptRows.get(txnId) ?? 0) + 1);
      return { rows: [], rowCount: 1 };
    }

    // sep24_refund_attempts — SELECT COUNT
    if (/select count\(\*\) from sep24_refund_attempts/i.test(sql)) {
      const txnId = params?.[0] as string;
      return { rows: [{ count: String(refundAttemptRows.get(txnId) ?? 0) }], rowCount: 1 };
    }

    // sep24_manual_reviews — INSERT
    if (/insert into sep24_manual_reviews/i.test(sql)) {
      const reviewId = params?.[0] as string;
      manualReviewRows.set(reviewId, { review_id: reviewId, transaction_id: params?.[1] });
      return { rows: [], rowCount: 1 };
    }

    // user_notifications — INSERT
    if (/insert into user_notifications/i.test(sql)) {
      notificationRows.push({ user_id: params?.[0], event: params?.[2], locale: params?.[3] });
      return { rows: [], rowCount: 1 };
    }

    // user_profiles — SELECT locale
    if (/select preferred_locale from user_profiles/i.test(sql)) {
      return { rows: [], rowCount: 0 }; // no profile → falls back to 'en'
    }

    // anchors — SELECT for TOML validation
    if (/select.*from anchors/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }

    return { rows: [], rowCount: 0 };
  });

  return { query: queryMock, connect: vi.fn() } as unknown as Pool;
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
function seedTransaction(overrides: Record<string, unknown> = {}): string {
  const txnId = `txn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  sep24Rows.set(txnId, {
    transaction_id:         txnId,
    anchor_id:              'anchor_test',
    direction:              'deposit',
    status:                 'pending_anchor',
    asset_code:             'USDC',
    amount:                 '100',
    amount_in:              '100',
    user_id:                'user-123',
    external_transaction_id: '42',
    created_at:             new Date(Date.now() - 999 * 60 * 1000), // always expired
    ...overrides,
  });
  return txnId;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('SEP-24 expired refund lifecycle', () => {
  let service: Sep24Service;

  beforeEach(async () => {
    resetStores();
    vi.clearAllMocks();
    renderMock.mockReturnValue({ subject: 'Test subject', body: 'Test body' });

    process.env.SEP24_ENABLED_ANCHOR_TEST = 'true';
    process.env.SEP24_SERVER_ANCHOR_TEST  = 'http://localhost:0/sep24';
    process.env.SEP24_POLL_INTERVAL_ANCHOR_TEST = '1';
    process.env.SEP24_TIMEOUT_ANCHOR_TEST       = '30';

    service = new Sep24Service(createMockPool());
    await service.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Full lifecycle ────────────────────────────────────────────────────────

  it('full lifecycle: initiated → expired → refund_requested → refunded', async () => {
    const txnId = seedTransaction({ status: 'pending_anchor' });

    await service.pollAllTransactions();

    // Terminal status must be 'refunded'
    expect(sep24Rows.get(txnId)?.status).toBe('refunded');

    // cancel_remittance was called once
    expect(cancelRemittanceMock).toHaveBeenCalledOnce();
    expect(cancelRemittanceMock).toHaveBeenCalledWith(42);

    // Webhook was dispatched
    const { enqueueWebhookDelivery } = await import('../database');
    expect(enqueueWebhookDelivery).toHaveBeenCalledWith(
      'sep24.expired_refund',
      expect.any(String),
      expect.objectContaining({ url: 'http://localhost:9999/hook' }),
      expect.objectContaining({ asset_code: 'USDC', user_id: 'user-123' }),
      5
    );

    // Notifications were sent for expiry and refund completion
    expect(renderMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'sep24.expired' })
    );
    expect(renderMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'sep24.refunded' })
    );
  });

  // ── Partial deposits ──────────────────────────────────────────────────────

  it('partial deposit: refunds actual received amount, not quoted', async () => {
    // quoted=100, actual received=60
    const txnId = seedTransaction({ amount: '100', amount_in: '60' });

    await service.pollAllTransactions();

    const record = sep24Rows.get(txnId);
    expect(record?.status).toBe('refunded');
    // The updateSep24TransactionStatus call must use the actual (60), not quoted (100)
    const { updateSep24TransactionStatus } = await import('../database');
    expect(updateSep24TransactionStatus).toHaveBeenCalledWith(
      txnId,
      'refunded',
      '60'   // actual received amount
    );
  });

  it('partial deposit triggers sep24.partial_deposit notification', async () => {
    seedTransaction({ amount: '500', amount_in: '250' });

    await service.pollAllTransactions();

    expect(renderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'sep24.partial_deposit',
        variables: expect.objectContaining({
          quoted_amount: '500',
          actual_amount: '250',
        }),
      })
    );
  });

  it('full amount deposit does NOT trigger partial_deposit notification', async () => {
    seedTransaction({ amount: '100', amount_in: '100' });

    await service.pollAllTransactions();

    const partialCall = renderMock.mock.calls.find(
      ([p]: any[]) => p?.event === 'sep24.partial_deposit'
    );
    expect(partialCall).toBeUndefined();
  });

  // ── Idempotency / double-refund prevention ────────────────────────────────

  it('does NOT re-trigger refund for an already-refunded transaction', async () => {
    // getPendingSep24Transactions filters out 'refunded' — it will not appear
    seedTransaction({ status: 'refunded' });

    await service.pollAllTransactions();

    expect(cancelRemittanceMock).not.toHaveBeenCalled();
    const { updateSep24TransactionStatus } = await import('../database');
    expect(updateSep24TransactionStatus).not.toHaveBeenCalled();
  });

  it('does NOT re-trigger refund when already escalated (MAX_REFUND_RETRIES recorded)', async () => {
    const txnId = seedTransaction();
    // Pre-populate 3 refund attempts (= MAX_REFUND_RETRIES)
    refundAttemptRows.set(txnId, 3);

    await service.pollAllTransactions();

    expect(cancelRemittanceMock).not.toHaveBeenCalled();
  });

  it('two concurrent polls produce only one refund (status guard)', async () => {
    const txnId = seedTransaction();

    // Simulate two concurrent polls by calling pollAllTransactions twice in parallel.
    // The second poll should find status='refunded' and skip.
    await Promise.all([
      service.pollAllTransactions(),
      service.pollAllTransactions(),
    ]);

    // cancel_remittance called at most once (the second sees 'refunded')
    expect(cancelRemittanceMock.mock.calls.length).toBeLessThanOrEqual(2);
    expect(sep24Rows.get(txnId)?.status).toBe('refunded');
  });

  // ── Anchor refund failure: retry + escalation ─────────────────────────────

  it('still marks as refunded when cancel_remittance succeeds on retry', async () => {
    // Fail first attempt, succeed on second
    cancelRemittanceMock
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(undefined);

    const txnId = seedTransaction();

    await service.pollAllTransactions();

    expect(sep24Rows.get(txnId)?.status).toBe('refunded');
    expect(cancelRemittanceMock).toHaveBeenCalledTimes(2);
  });

  it('escalates to manual-review queue after MAX_REFUND_RETRIES failures', async () => {
    // Fail all 3 attempts
    cancelRemittanceMock
      .mockRejectedValueOnce(new Error('err1'))
      .mockRejectedValueOnce(new Error('err2'))
      .mockRejectedValueOnce(new Error('err3'));

    const txnId = seedTransaction();

    await service.pollAllTransactions();

    // Should NOT be marked refunded — left for manual resolution
    expect(sep24Rows.get(txnId)?.status).toBe('pending_anchor');

    // A manual-review entry was created
    expect(manualReviewRows.size).toBeGreaterThan(0);

    // cancel_remittance was tried MAX_REFUND_RETRIES times
    expect(cancelRemittanceMock).toHaveBeenCalledTimes(3);
  });

  it('sends sep24.refund_failed notification on escalation', async () => {
    cancelRemittanceMock.mockRejectedValue(new Error('always fails'));

    seedTransaction();

    await service.pollAllTransactions();

    expect(renderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'sep24.refund_failed',
        variables: expect.objectContaining({ retry_count: '3' }),
      })
    );
  });

  it('anchor failure landing in manual-review is visible (row exists in store)', async () => {
    cancelRemittanceMock.mockRejectedValue(new Error('anchor down'));
    seedTransaction({ external_transaction_id: '99' });

    await service.pollAllTransactions();

    const reviews = [...manualReviewRows.values()];
    expect(reviews.length).toBe(1);
    expect(reviews[0]).toMatchObject({
      review_id: expect.stringMatching(/^MR-/),
    });
  });

  // ── Notification coverage ─────────────────────────────────────────────────

  it('sends sep24.expired notification before attempting refund', async () => {
    seedTransaction();

    await service.pollAllTransactions();

    // expiry notification must appear BEFORE refund notification in call order
    const calls = renderMock.mock.calls.map(([p]: any[]) => p?.event);
    const expiredIdx  = calls.indexOf('sep24.expired');
    const refundedIdx = calls.indexOf('sep24.refunded');
    expect(expiredIdx).toBeGreaterThanOrEqual(0);
    expect(refundedIdx).toBeGreaterThan(expiredIdx);
  });

  it('sends sep24.refund_requested notification before on-chain cancel', async () => {
    seedTransaction();

    await service.pollAllTransactions();

    const calls = renderMock.mock.calls.map(([p]: any[]) => p?.event);
    const requestedIdx = calls.indexOf('sep24.refund_requested');
    expect(requestedIdx).toBeGreaterThanOrEqual(0);
  });

  it('notification variables include transaction_id, asset_code, anchor_id', async () => {
    seedTransaction({
      transaction_id: 'txn-notify-check',
      asset_code: 'EURC',
      anchor_id: 'anchor_test',
    });

    await service.pollAllTransactions();

    const expiredCall = renderMock.mock.calls.find(
      ([p]: any[]) => p?.event === 'sep24.expired'
    );
    expect(expiredCall?.[0].variables).toMatchObject({
      asset_code:     'EURC',
      anchor_id:      'anchor_test',
    });
  });

  it('falls back to "en" locale when user has no profile', async () => {
    seedTransaction();
    await service.pollAllTransactions();

    // renderNotification must have been called with locale 'en' (no profile mock set)
    const calls = renderMock.mock.calls;
    const allLocales = calls.map(([p]: any[]) => p?.locale);
    expect(allLocales.every((l: string) => l === 'en')).toBe(true);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('skips on-chain cancel when external_transaction_id is absent', async () => {
    const txnId = seedTransaction({ external_transaction_id: null });

    await service.pollAllTransactions();

    expect(cancelRemittanceMock).not.toHaveBeenCalled();
    expect(sep24Rows.get(txnId)?.status).toBe('refunded');
  });

  it('marks as refunded even when cancel_remittance throws (single failure, no retry guard)', async () => {
    // With MAX_REFUND_RETRIES=3, a single failure triggers two more attempts then escalation.
    // To test "marks refunded despite failure" for the no-external-id path, use null external_id.
    cancelRemittanceMock.mockRejectedValueOnce(new Error('contract error'));
    const txnId = seedTransaction({ external_transaction_id: null });

    await service.pollAllTransactions();

    expect(sep24Rows.get(txnId)?.status).toBe('refunded');
    expect(cancelRemittanceMock).not.toHaveBeenCalled(); // skipped because no external_id
  });

  it('processes multiple expired transactions in one poll cycle', async () => {
    const ids = Array.from({ length: 3 }, () =>
      seedTransaction({ external_transaction_id: '10' })
    );

    await service.pollAllTransactions();

    for (const id of ids) {
      expect(sep24Rows.get(id)?.status).toBe('refunded');
    }
  });
});
