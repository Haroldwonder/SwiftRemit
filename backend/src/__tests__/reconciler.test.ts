/**
 * On-chain reconciler tests (Feature C)
 *
 * Covers:
 *  - Every status divergence is detected and repaired within one cycle
 *  - Every correction is written to the audit log with before/after values
 *  - Ledger-sequence gaps are detected and backfilled
 *  - Divergence alert fires when count > 0 for two consecutive cycles
 *  - No-op when DB and chain agree
 *  - RPC outage skips the row without crashing the cycle
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  runReconciliationCycle,
  reconcileLedgerGaps,
  resetReconcilerMetrics,
  getReconcilerMetrics,
  mapOnChainStatus,        // tested as internal export for unit coverage
} from '../reconciler';

// ---------------------------------------------------------------------------
// Re-export the mapping function so tests can import it
// ---------------------------------------------------------------------------
// (We expose it via the module; see reconciler.ts — function is exported)

// ---------------------------------------------------------------------------
// Hoisted mutable stores
// ---------------------------------------------------------------------------
const {
  dbTransactions,
  dbAuditLog,
  dbContractEvents,
  dbLedgerSequences,
  resetAll,
} = vi.hoisted(() => {
  const dbTransactions: Record<string, { transaction_id: string; status: string; external_transaction_id: string | null }> = {};
  const dbAuditLog: Array<Record<string, unknown>> = [];
  const dbContractEvents: Array<Record<string, unknown>> = [];
  const dbLedgerSequences: number[] = [];
  const resetAll = () => {
    Object.keys(dbTransactions).forEach((k) => delete dbTransactions[k]);
    dbAuditLog.length = 0;
    dbContractEvents.length = 0;
    dbLedgerSequences.length = 0;
  };
  return { dbTransactions, dbAuditLog, dbContractEvents, dbLedgerSequences, resetAll };
});

// ---------------------------------------------------------------------------
// Mock get_remittance (on-chain call)
// ---------------------------------------------------------------------------
const { getRemittanceMock } = vi.hoisted(() => ({
  getRemittanceMock: vi.fn<(id: number) => Promise<{ id: number; status: string; amount: string; sender: string; agent: string } | null>>(),
}));

vi.mock('../reconciler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reconciler')>();
  return {
    ...actual,
    getRemittanceOnChain: getRemittanceMock,
  };
});

// ---------------------------------------------------------------------------
// Mock audit log
// ---------------------------------------------------------------------------
vi.mock('../admin-audit-log', () => ({
  AdminAuditLogService: vi.fn().mockImplementation(() => ({
    log: vi.fn(async (entry: Record<string, unknown>) => {
      dbAuditLog.push(entry);
    }),
  })),
}));

// ---------------------------------------------------------------------------
// Mock database (saveContractEvent)
// ---------------------------------------------------------------------------
vi.mock('../database', () => ({
  saveContractEvent: vi.fn(async (ev: Record<string, unknown>) => {
    dbContractEvents.push(ev);
  }),
  getPool: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock stellar-network
// ---------------------------------------------------------------------------
vi.mock('../stellar-network', () => ({
  getStellarRuntimeConfig: vi.fn(() => ({
    rpcUrl: 'http://localhost:0',
    networkPassphrase: 'Test SDF Network ; September 2015',
  })),
}));

// ---------------------------------------------------------------------------
// Mock SorobanRpc server (getEvents for ledger backfill)
// ---------------------------------------------------------------------------
vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getEvents: vi.fn().mockResolvedValue({ events: [] }),
        simulateTransaction: vi.fn(),
      })),
    },
  };
});

// ---------------------------------------------------------------------------
// Mock node-cron (to prevent real scheduling)
// ---------------------------------------------------------------------------
vi.mock('node-cron', () => ({
  default: { schedule: vi.fn().mockReturnValue({ stop: vi.fn() }) },
  schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Pool factory
// ---------------------------------------------------------------------------
function makePool(overrideQuery?: (sql: string, params?: unknown[]) => any): Pool {
  const query = vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
    if (overrideQuery) {
      const override = overrideQuery(sql, params);
      if (override !== undefined) return override;
    }

    // Default: transactions SELECT
    if (/select transaction_id, status, external_transaction_id/i.test(sql)) {
      return {
        rows: Object.values(dbTransactions).filter(
          (t) => !['completed', 'refunded'].includes(t.status)
        ),
        rowCount: Object.values(dbTransactions).length,
      };
    }

    // UPDATE transactions status
    if (/update transactions set status/i.test(sql)) {
      const newStatus = params?.[0] as string;
      const txnId     = params?.[1] as string;
      if (dbTransactions[txnId]) dbTransactions[txnId].status = newStatus;
      return { rows: [], rowCount: 1 };
    }

    // Ledger sequences SELECT
    if (/select distinct ledger_sequence/i.test(sql)) {
      return {
        rows: dbLedgerSequences.map((s) => ({ ledger_sequence: s })),
        rowCount: dbLedgerSequences.length,
      };
    }

    return { rows: [], rowCount: 0 };
  });
  return { query } as unknown as Pool;
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
function seedTransaction(
  id: string,
  dbStatus: string,
  externalId: string | null = String(Math.floor(Math.random() * 1000))
): void {
  dbTransactions[id] = {
    transaction_id:          id,
    status:                  dbStatus,
    external_transaction_id: externalId,
  };
}

function chainReturns(remittanceId: number, onChainStatus: string): void {
  getRemittanceMock.mockResolvedValue({
    id:     remittanceId,
    status: onChainStatus,
    amount: '1000',
    sender: 'GABC',
    agent:  'GDEF',
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Reconciler', () => {
  beforeEach(() => {
    resetAll();
    resetReconcilerMetrics();
    vi.clearAllMocks();
  });

  // ── Status divergence for every status ─────────────────────────────────

  const STATUS_PAIRS: Array<[string, string, string]> = [
    // [db_status, onchain_status, expected_repair]
    ['pending_user_transfer_start', 'Completed', 'completed'],
    ['pending_anchor',              'Cancelled', 'refunded'],
    ['pending_stellar',             'Expired',   'expired'],
    ['pending_external',            'Completed', 'completed'],
    ['pending_user',                'Completed', 'completed'],
    ['error',                       'Cancelled', 'refunded'],
  ];

  for (const [dbStatus, chainStatus, expectedRepair] of STATUS_PAIRS) {
    it(`detects and repairs divergence: DB=${dbStatus} → chain=${chainStatus} → DB=${expectedRepair}`, async () => {
      seedTransaction('txn-1', dbStatus, '10');
      chainReturns(10, chainStatus);

      const pool = makePool();
      await runReconciliationCycle(pool);

      expect(dbTransactions['txn-1'].status).toBe(expectedRepair);
      expect(getReconcilerMetrics().divergences_repaired).toBe(1);
    });
  }

  it('no-op when DB status matches chain status', async () => {
    seedTransaction('txn-ok', 'pending_anchor', '5');
    chainReturns(5, 'Pending');

    const pool = makePool();
    await runReconciliationCycle(pool);

    expect(dbTransactions['txn-ok'].status).toBe('pending_anchor');
    expect(getReconcilerMetrics().divergences_total).toBe(0);
  });

  // ── Audit log ─────────────────────────────────────────────────────────

  it('writes audit log entry with before/after values for every repair', async () => {
    seedTransaction('txn-audit', 'pending_stellar', '77');
    chainReturns(77, 'Completed');

    const pool = makePool();
    await runReconciliationCycle(pool);

    expect(dbAuditLog).toHaveLength(1);
    const entry = dbAuditLog[0] as any;
    expect(entry.action).toBe('reconciler_repair');
    expect(entry.target).toBe('txn-audit');
    expect(entry.params_json.before_status).toBe('pending_stellar');
    expect(entry.params_json.after_status).toBe('completed');
    expect(entry.params_json.chain_status).toBe('Completed');
    expect(entry.params_json.repaired_at).toBeDefined();
  });

  it('writes separate audit log entries for each divergent transaction', async () => {
    seedTransaction('txn-a', 'pending_anchor',   '1');
    seedTransaction('txn-b', 'pending_external', '2');
    getRemittanceMock
      .mockResolvedValueOnce({ id: 1, status: 'Completed', amount: '100', sender: '', agent: '' })
      .mockResolvedValueOnce({ id: 2, status: 'Cancelled', amount: '200', sender: '', agent: '' });

    const pool = makePool();
    await runReconciliationCycle(pool);

    expect(dbAuditLog).toHaveLength(2);
    expect(getReconcilerMetrics().divergences_repaired).toBe(2);
  });

  // ── RPC outage handling ────────────────────────────────────────────────

  it('skips a row on RPC error without crashing the cycle', async () => {
    seedTransaction('txn-rpc-err', 'pending_anchor', '20');
    seedTransaction('txn-ok',      'pending_anchor', '21');
    getRemittanceMock
      .mockRejectedValueOnce(new Error('RPC timeout'))
      .mockResolvedValueOnce({ id: 21, status: 'Completed', amount: '50', sender: '', agent: '' });

    const pool = makePool();
    await runReconciliationCycle(pool);

    // txn-rpc-err skipped, txn-ok repaired
    expect(dbTransactions['txn-rpc-err'].status).toBe('pending_anchor');
    expect(dbTransactions['txn-ok'].status).toBe('completed');
  });

  it('skips rows with no external_transaction_id', async () => {
    seedTransaction('txn-no-ext', 'pending_anchor', null);

    const pool = makePool();
    await runReconciliationCycle(pool);

    expect(getRemittanceMock).not.toHaveBeenCalled();
    expect(dbTransactions['txn-no-ext'].status).toBe('pending_anchor');
  });

  // ── Divergence alerting ────────────────────────────────────────────────

  it('fires alert after two consecutive divergent cycles', async () => {
    seedTransaction('txn-alert', 'pending_anchor', '30');
    chainReturns(30, 'Completed');

    const pool = makePool();

    // Cycle 1 — divergence, no alert yet
    await runReconciliationCycle(pool);
    expect(getReconcilerMetrics().consecutive_divergent_cycles).toBe(1);

    // Re-seed for cycle 2
    dbTransactions['txn-alert'].status = 'pending_anchor';
    dbTransactions['txn-alert'].external_transaction_id = '30';
    dbAuditLog.length = 0;
    getRemittanceMock.mockResolvedValue({ id: 30, status: 'Completed', amount: '0', sender: '', agent: '' });

    // Cycle 2 — divergence, alert fires
    await runReconciliationCycle(pool);
    expect(getReconcilerMetrics().consecutive_divergent_cycles).toBe(2);

    // The alert is written to the audit log (action = 'divergence_alert')
    const alertEntry = dbAuditLog.find((e: any) => e.action === 'divergence_alert') as any;
    expect(alertEntry).toBeDefined();
    expect(alertEntry.params_json.consecutive_cycles).toBeGreaterThanOrEqual(2);
  });

  it('resets consecutive_divergent_cycles when a cycle is clean', async () => {
    seedTransaction('txn-conv', 'pending_anchor', '40');
    chainReturns(40, 'Completed');

    const pool = makePool();

    // Cycle 1: divergent
    await runReconciliationCycle(pool);
    expect(getReconcilerMetrics().consecutive_divergent_cycles).toBe(1);

    // Cycle 2: clean (chain now agrees)
    dbTransactions['txn-conv'].status = 'completed';
    chainReturns(40, 'Completed');

    await runReconciliationCycle(pool);
    expect(getReconcilerMetrics().consecutive_divergent_cycles).toBe(0);
  });

  // ── Ledger-gap detection ───────────────────────────────────────────────

  it('detects gaps in ledger sequences', async () => {
    // Sequences 100, 101, 103 — gap at 102
    dbLedgerSequences.push(100, 101, 103);
    getRemittanceMock.mockResolvedValue(null);

    const pool = makePool();
    await runReconciliationCycle(pool);

    expect(getReconcilerMetrics().ledger_gaps_detected).toBeGreaterThanOrEqual(1);
  });

  it('no gaps reported when sequences are contiguous', async () => {
    dbLedgerSequences.push(200, 201, 202, 203);
    getRemittanceMock.mockResolvedValue(null);

    const pool = makePool();
    await runReconciliationCycle(pool);

    expect(getReconcilerMetrics().ledger_gaps_detected).toBe(0);
  });

  it('reconcileLedgerGaps increments backfill counter for each gap filled', async () => {
    // CONTRACT_ID must be set for backfill to run
    process.env.CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    dbLedgerSequences.push(10, 12); // gap at 11

    const pool = makePool();
    await reconcileLedgerGaps(pool);

    expect(getReconcilerMetrics().ledger_gaps_detected).toBe(1);
    // backfill attempt is made (mock RPC returns empty events — counter incremented)
    expect(getReconcilerMetrics().ledger_gaps_backfilled).toBe(1);

    delete process.env.CONTRACT_ID;
  });

  // ── Metrics ───────────────────────────────────────────────────────────

  it('updates last_run_timestamp after each cycle', async () => {
    const pool = makePool();
    const before = getReconcilerMetrics().last_run_timestamp_seconds;

    await runReconciliationCycle(pool);

    expect(getReconcilerMetrics().last_run_timestamp_seconds).toBeGreaterThan(before);
  });

  it('records duration_ms for each cycle', async () => {
    const pool = makePool();
    await runReconciliationCycle(pool);

    expect(getReconcilerMetrics().last_run_duration_ms).toBeGreaterThanOrEqual(0);
  });
});
