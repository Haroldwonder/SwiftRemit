/**
 * Integration test: SEP-24 expired refund flow (issue #434)
 *
 * Verifies that when a SEP-24 transaction expires:
 *  1. cancel_remittance is called on the Soroban contract.
 *  2. The transaction status is updated to 'refunded'.
 *  3. A sep24.expired_refund webhook event is dispatched.
 *  4. A second poll does NOT re-trigger the refund (idempotency).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { Sep24Service } from '../sep24-service';

// ---------------------------------------------------------------------------
// Shared in-memory store (hoisted so vi.mock factories can reference it)
// ---------------------------------------------------------------------------
const { sep24Rows, resetSep24Rows } = vi.hoisted(() => {
  const sep24Rows = new Map<string, Record<string, unknown>>();
  const resetSep24Rows = () => sep24Rows.clear();
  return { sep24Rows, resetSep24Rows };
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
      async (
        transactionId: string,
        status: string,
        amountIn?: string,
        amountOut?: string,
        amountFee?: string
      ) => {
        const prev = sep24Rows.get(transactionId);
        if (!prev) return;
        sep24Rows.set(transactionId, {
          ...prev,
          status,
          amount_in: amountIn ?? prev.amount_in,
          amount_out: amountOut ?? prev.amount_out,
          amount_fee: amountFee ?? prev.amount_fee,
        });
      }
    ),
    // Webhook delivery helpers — no-op stubs
    getActiveWebhookSubscribers: vi.fn().mockResolvedValue([
      { id: 'sub-1', url: 'http://localhost:9999/hook', active: true },
    ]),
    enqueueWebhookDelivery: vi.fn().mockResolvedValue({
      id: 'delivery-1',
      event_type: 'sep24.expired_refund',
      event_key: 'txn-expired-1',
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
// Mock stellar module — capture calls to cancelRemittanceOnChain
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
// Helpers
// ---------------------------------------------------------------------------
const createMockPool = (): Pool => ({}) as Pool;

function seedExpiredTransaction(overrides: Record<string, unknown> = {}): string {
  const txnId = `txn-expired-${Date.now()}`;
  sep24Rows.set(txnId, {
    transaction_id: txnId,
    anchor_id: 'anchor_test',
    direction: 'deposit',
    status: 'pending_anchor',
    asset_code: 'USDC',
    amount: '100.00',
    user_id: 'user-123',
    external_transaction_id: '42', // on-chain remittance_id
    created_at: new Date(Date.now() - 999 * 60 * 1000), // 999 minutes ago → always expired
    ...overrides,
  });
  return txnId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SEP-24 expired refund flow', () => {
  let service: Sep24Service;

  beforeEach(async () => {
    resetSep24Rows();
    vi.clearAllMocks();

    process.env.SEP24_ENABLED_ANCHOR_TEST = 'true';
    process.env.SEP24_SERVER_ANCHOR_TEST = 'http://localhost:0/sep24';
    process.env.SEP24_POLL_INTERVAL_ANCHOR_TEST = '1';
    process.env.SEP24_TIMEOUT_ANCHOR_TEST = '30'; // 30 min timeout

    service = new Sep24Service(createMockPool());
    await service.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls cancel_remittance on the contract when a transaction expires', async () => {
    seedExpiredTransaction({ external_transaction_id: '42' });

    await service.pollAllTransactions();

    expect(cancelRemittanceMock).toHaveBeenCalledOnce();
    expect(cancelRemittanceMock).toHaveBeenCalledWith(42);
  });

  it('marks the transaction as refunded after expiry', async () => {
    const txnId = seedExpiredTransaction({ external_transaction_id: '7' });

    await service.pollAllTransactions();

    const record = sep24Rows.get(txnId);
    expect(record?.status).toBe('refunded');
  });

  it('dispatches a sep24.expired_refund webhook event', async () => {
    const { enqueueWebhookDelivery } = await import('../database');
    seedExpiredTransaction({ external_transaction_id: '99' });

    await service.pollAllTransactions();

    expect(enqueueWebhookDelivery).toHaveBeenCalledWith(
      'sep24.expired_refund',
      expect.any(String),
      expect.objectContaining({ url: 'http://localhost:9999/hook' }),
      expect.objectContaining({ asset_code: 'USDC', user_id: 'user-123' }),
      5
    );
  });

  it('does NOT re-trigger refund for an already-refunded transaction (idempotency)', async () => {
    // Seed a transaction that is already in 'refunded' state.
    // getPendingSep24Transactions filters out 'refunded', so it won't appear in the poll.
    seedExpiredTransaction({ status: 'refunded', external_transaction_id: '10' });

    await service.pollAllTransactions();

    // cancel_remittance must NOT be called again
    expect(cancelRemittanceMock).not.toHaveBeenCalled();
  });

  it('still marks as refunded even when cancel_remittance throws', async () => {
    cancelRemittanceMock.mockRejectedValueOnce(new Error('contract error'));
    const txnId = seedExpiredTransaction({ external_transaction_id: '5' });

    await service.pollAllTransactions();

    // Status should still be updated to 'refunded' so we don't retry forever
    const record = sep24Rows.get(txnId);
    expect(record?.status).toBe('refunded');
  });

  it('skips on-chain cancel when external_transaction_id is absent', async () => {
    const txnId = seedExpiredTransaction({ external_transaction_id: null });

    await service.pollAllTransactions();

    expect(cancelRemittanceMock).not.toHaveBeenCalled();
    // But the transaction should still be marked refunded
    const record = sep24Rows.get(txnId);
    expect(record?.status).toBe('refunded');
  });
});
