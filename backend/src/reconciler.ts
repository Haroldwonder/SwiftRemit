/**
 * On-chain reconciler (Feature C)
 *
 * Walks recent remittance IDs in the DB and compares each status against the
 * Soroban contract's get_remittance view. Any divergence is:
 *   1. Re-derived from the contract and written back to the DB.
 *   2. Written to the audit log with before/after values.
 *   3. Counted toward a Prometheus gauge that triggers an alert when
 *      the count exceeds zero for two consecutive cycles.
 *
 * Ledger-gap detection: the reconciler also walks the contract_events table
 * to find missing ledger sequence numbers and backfills them by re-fetching
 * from the RPC node.
 *
 * Scheduling: call `startReconcilerSchedule(pool)` once at app start-up.
 * The schedule runs every RECONCILER_INTERVAL_MS (default 5 min).
 */

import cron from 'node-cron';
import { Pool } from 'pg';
import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  Keypair,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { getStellarRuntimeConfig } from './stellar-network';
import { createLogger } from './correlation-id';
import { AdminAuditLogService } from './admin-audit-log';
import { saveContractEvent } from './database';

const logger = createLogger('reconciler');
const { rpcUrl, networkPassphrase } = getStellarRuntimeConfig();
const rpcServer = new SorobanRpc.Server(rpcUrl, { allowHttp: true });

// ---------------------------------------------------------------------------
// Constants (overridable via env)
// ---------------------------------------------------------------------------
const RECONCILER_BATCH_SIZE   = parseInt(process.env.RECONCILER_BATCH_SIZE   ?? '100',  10);
const RECONCILER_LOOKBACK_HRS = parseInt(process.env.RECONCILER_LOOKBACK_HRS ?? '24',   10);
const RECONCILER_CRON         =           process.env.RECONCILER_CRON         ?? '*/5 * * * *'; // every 5 min
const DIVERGENCE_ALERT_THRESHOLD = 0; // alert when count > 0 for two cycles

// ---------------------------------------------------------------------------
// Prometheus-style in-process metrics
// ---------------------------------------------------------------------------

interface ReconcilerMetrics {
  divergences_total:          number;
  divergences_repaired:       number;
  ledger_gaps_detected:       number;
  ledger_gaps_backfilled:     number;
  last_run_timestamp_seconds: number;
  last_run_duration_ms:       number;
  consecutive_divergent_cycles: number;
}

let metrics: ReconcilerMetrics = {
  divergences_total:            0,
  divergences_repaired:         0,
  ledger_gaps_detected:         0,
  ledger_gaps_backfilled:       0,
  last_run_timestamp_seconds:   0,
  last_run_duration_ms:         0,
  consecutive_divergent_cycles: 0,
};

/** Expose current metrics snapshot (used by MetricsService for Prometheus text). */
export function getReconcilerMetrics(): Readonly<ReconcilerMetrics> {
  return { ...metrics };
}

/** Reset metrics — useful in tests. */
export function resetReconcilerMetrics(): void {
  metrics = {
    divergences_total:            0,
    divergences_repaired:         0,
    ledger_gaps_detected:         0,
    ledger_gaps_backfilled:       0,
    last_run_timestamp_seconds:   0,
    last_run_duration_ms:         0,
    consecutive_divergent_cycles: 0,
  };
}

// ---------------------------------------------------------------------------
// On-chain status types
// ---------------------------------------------------------------------------

/** Status values the contract can return for a remittance. */
export type OnChainStatus =
  | 'Pending'
  | 'Completed'
  | 'Cancelled'
  | 'Expired'
  | 'NotFound';

/** Lightweight view returned by get_remittance. */
export interface OnChainRemittance {
  id:       number;
  status:   OnChainStatus;
  amount:   string;
  sender:   string;
  agent:    string;
}

// ---------------------------------------------------------------------------
// Contract interaction
// ---------------------------------------------------------------------------

/**
 * Call get_remittance(id) on the Soroban contract.
 * Returns null when the contract returns None / not found.
 */
export async function getRemittanceOnChain(remittanceId: number): Promise<OnChainRemittance | null> {
  const contractId = process.env.CONTRACT_ID;
  if (!contractId) throw new Error('CONTRACT_ID not configured');

  const contract = new Contract(contractId);
  const keypair  = Keypair.random();

  const fakeSource = {
    accountId:               () => keypair.publicKey(),
    sequenceNumber:          () => '0',
    incrementSequenceNumber: () => {},
  } as any;

  const tx = new TransactionBuilder(fakeSource, { fee: '100', networkPassphrase })
    .addOperation(contract.call('get_remittance', nativeToScVal(remittanceId, { type: 'u64' })))
    .setTimeout(30)
    .build();

  const simulated = await rpcServer.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simulated)) {
    logger.warn('get_remittance simulation error', { remittanceId, error: simulated.error });
    return null;
  }

  const retval = (simulated as SorobanRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
  if (!retval) return null;

  try {
    // The contract returns Option<Remittance>; scvVoid means None.
    if (retval.switch().name === 'scvVoid') return null;

    // Unwrap Some(remittance)
    const inner = retval.vec()?.[0];
    if (!inner) return null;

    const map    = inner.map()!;
    const getStr = (key: string) => map.find((e) => e.key().sym() === key)?.val().str().toString() ?? '';
    const getI128 = (key: string): string => {
      const e = map.find((m) => m.key().sym() === key);
      if (!e) return '0';
      const i = e.val().i128();
      return ((BigInt(i.hi().toString()) << BigInt(64)) | BigInt(i.lo().toString())).toString();
    };
    const getSym = (key: string) => map.find((e) => e.key().sym() === key)?.val().sym() ?? '';

    return {
      id:     remittanceId,
      status: getSym('status') as OnChainStatus,
      amount: getI128('amount'),
      sender: getStr('sender'),
      agent:  getStr('agent'),
    };
  } catch (err) {
    logger.error('Failed to parse get_remittance response', { remittanceId, err });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

const ON_CHAIN_TO_DB_STATUS: Record<string, string> = {
  Pending:   'pending_user_transfer_start',
  Completed: 'completed',
  Cancelled: 'refunded',
  Expired:   'expired',
};

export function mapOnChainStatus(onChain: OnChainStatus): string {
  return ON_CHAIN_TO_DB_STATUS[onChain] ?? 'error';
}

// ---------------------------------------------------------------------------
// Core reconciler logic
// ---------------------------------------------------------------------------

/**
 * Run one full reconciliation cycle:
 *  1. Load recent transactions from the DB.
 *  2. For each, call get_remittance on-chain.
 *  3. If DB status ≠ derived chain status, repair and log.
 *  4. Detect ledger-sequence gaps and backfill.
 *  5. Update metrics and fire alert if threshold exceeded.
 */
export async function runReconciliationCycle(pool: Pool): Promise<void> {
  const startMs = Date.now();
  logger.info('Reconciliation cycle starting');

  let cycleDiv = 0;

  try {
    // ── Step 1: Load recent transactions ─────────────────────────────────
    const cutoff = new Date(Date.now() - RECONCILER_LOOKBACK_HRS * 3600 * 1000);
    const result = await pool.query<{
      transaction_id: string;
      status: string;
      external_transaction_id: string | null;
    }>(
      `SELECT transaction_id, status, external_transaction_id
         FROM transactions
        WHERE created_at >= $1
          AND status NOT IN ('completed', 'refunded')
        ORDER BY created_at DESC
        LIMIT $2`,
      [cutoff, RECONCILER_BATCH_SIZE]
    );

    const auditService = new AdminAuditLogService(pool);

    for (const row of result.rows) {
      const remittanceId = row.external_transaction_id
        ? parseInt(row.external_transaction_id, 10)
        : null;

      if (remittanceId === null || isNaN(remittanceId)) continue;

      // ── Step 2: Query chain ─────────────────────────────────────────────
      let onChain: OnChainRemittance | null;
      try {
        onChain = await getRemittanceOnChain(remittanceId);
      } catch (err) {
        logger.error('RPC error during reconciliation, skipping', {
          transaction_id: row.transaction_id,
          remittanceId,
          err,
        });
        continue;
      }

      if (!onChain) {
        logger.warn('get_remittance returned null — skipping', { remittanceId });
        continue;
      }

      const derivedStatus = mapOnChainStatus(onChain.status);

      // ── Step 3: Detect and repair divergence ────────────────────────────
      if (row.status !== derivedStatus) {
        cycleDiv++;
        metrics.divergences_total++;

        logger.warn('Divergence detected', {
          transaction_id: row.transaction_id,
          db_status:      row.status,
          chain_status:   onChain.status,
          derived_status: derivedStatus,
        });

        // Repair
        await pool.query(
          `UPDATE transactions SET status = $1, updated_at = NOW() WHERE transaction_id = $2`,
          [derivedStatus, row.transaction_id]
        );

        // Audit log — every correction recorded with before/after
        await auditService.log({
          admin_address: 'reconciler',
          action:        'reconciler_repair',
          target:        row.transaction_id,
          params_json: {
            remittance_id:  remittanceId,
            before_status:  row.status,
            after_status:   derivedStatus,
            chain_status:   onChain.status,
            chain_amount:   onChain.amount,
            repaired_at:    new Date().toISOString(),
          },
          tx_hash:    null,
          ip_address: null,
        });

        metrics.divergences_repaired++;
        logger.info('Divergence repaired', {
          transaction_id: row.transaction_id,
          before: row.status,
          after:  derivedStatus,
        });
      }
    }

    // ── Step 4: Ledger-gap detection and backfill ───────────────────────
    await reconcileLedgerGaps(pool);

    // ── Step 5: Update metrics and alerting ────────────────────────────
    if (cycleDiv > DIVERGENCE_ALERT_THRESHOLD) {
      metrics.consecutive_divergent_cycles++;
      if (metrics.consecutive_divergent_cycles >= 2) {
        logger.error('ALERT: divergence count exceeded threshold for two consecutive cycles', {
          divergences_this_cycle: cycleDiv,
          consecutive_cycles:     metrics.consecutive_divergent_cycles,
        });
        await fireAlert(pool, cycleDiv, metrics.consecutive_divergent_cycles);
      }
    } else {
      metrics.consecutive_divergent_cycles = 0;
    }
  } finally {
    metrics.last_run_timestamp_seconds = Math.floor(Date.now() / 1000);
    metrics.last_run_duration_ms       = Date.now() - startMs;
    logger.info('Reconciliation cycle complete', {
      duration_ms: metrics.last_run_duration_ms,
      divergences: cycleDiv,
    });
  }
}

// ---------------------------------------------------------------------------
// Ledger-gap detection
// ---------------------------------------------------------------------------

/**
 * Walk the contract_events table for the last RECONCILER_LOOKBACK_HRS hours.
 * Find gaps in ledger_sequence (skipped ledgers) and backfill by fetching
 * events from the RPC node for each missing ledger.
 */
export async function reconcileLedgerGaps(pool: Pool): Promise<void> {
  const contractId = process.env.CONTRACT_ID;
  if (!contractId) return;

  const cutoff = new Date(Date.now() - RECONCILER_LOOKBACK_HRS * 3600 * 1000);

  const rows = await pool.query<{ ledger_sequence: number }>(
    `SELECT DISTINCT ledger_sequence
       FROM contract_events
      WHERE timestamp >= $1
        AND ledger_sequence IS NOT NULL
      ORDER BY ledger_sequence ASC`,
    [cutoff]
  );

  const sequences = rows.rows.map((r) => r.ledger_sequence);
  if (sequences.length < 2) return;

  const min = sequences[0];
  const max = sequences[sequences.length - 1];
  const sequenceSet = new Set(sequences);

  const gaps: number[] = [];
  for (let seq = min + 1; seq < max; seq++) {
    if (!sequenceSet.has(seq)) gaps.push(seq);
  }

  if (gaps.length === 0) return;

  metrics.ledger_gaps_detected += gaps.length;
  logger.warn('Ledger gaps detected', { gap_count: gaps.length, gaps: gaps.slice(0, 10) });

  // Backfill each gap by fetching events from the RPC node
  for (const missingSeq of gaps) {
    try {
      await backfillLedger(pool, contractId, missingSeq);
      metrics.ledger_gaps_backfilled++;
    } catch (err) {
      logger.error('Failed to backfill ledger', { ledger_sequence: missingSeq, err });
    }
  }
}

/** Fetch and persist all contract events for a single ledger sequence. */
async function backfillLedger(pool: Pool, contractId: string, ledgerSeq: number): Promise<void> {
  const ledgerData = await rpcServer.getEvents({
    startLedger: ledgerSeq,
    filters: [{ type: 'contract', contractIds: [contractId] }],
    limit: 100,
  } as any);

  const events: SorobanRpc.Api.EventResponse[] = (ledgerData as any).events ?? [];

  for (const ev of events) {
    try {
      await saveContractEvent({
        event_type:      ev.type ?? 'unknown',
        remittance_id:   null,
        actor:           null,
        amount:          null,
        fee:             null,
        tx_hash:         ev.txHash ?? null,
        ledger_sequence: Number(ev.ledger ?? ledgerSeq),
        timestamp:       ev.ledgerClosedAt ? new Date(ev.ledgerClosedAt) : new Date(),
        raw_data:        { topics: ev.topic, value: ev.value } as any,
      });
    } catch (saveErr) {
      logger.error('Failed to save backfilled event', { ledger_sequence: ledgerSeq, saveErr });
    }
  }

  logger.info('Ledger backfilled', { ledger_sequence: ledgerSeq, event_count: events.length });
}

// ---------------------------------------------------------------------------
// Alerting
// ---------------------------------------------------------------------------

/**
 * Fire a divergence alert.
 * In production, integrate with PagerDuty / Opsgenie / Slack here.
 * For now writes to the admin audit log and emits a structured log at ERROR.
 */
async function fireAlert(pool: Pool, divergenceCount: number, consecutiveCycles: number): Promise<void> {
  try {
    const auditService = new AdminAuditLogService(pool);
    await auditService.log({
      admin_address: 'reconciler_alert',
      action:        'divergence_alert',
      target:        null,
      params_json: {
        divergence_count:         divergenceCount,
        consecutive_cycles:       consecutiveCycles,
        alert_fired_at:           new Date().toISOString(),
        remediation:              'Check reconciler logs and verify on-chain state',
      },
      tx_hash:    null,
      ip_address: null,
    });

    // Emit structured log at error level — picked up by log aggregators
    logger.error('DIVERGENCE_ALERT', {
      divergence_count:    divergenceCount,
      consecutive_cycles:  consecutiveCycles,
      alert_type:          'on_chain_state_divergence',
    });
  } catch (err) {
    logger.error('Failed to fire divergence alert', { err });
  }
}

// ---------------------------------------------------------------------------
// Prometheus text output
// ---------------------------------------------------------------------------

export function reconcilerMetricsText(): string {
  const m = getReconcilerMetrics();
  return [
    '# HELP reconciler_divergences_total Total divergences detected since startup',
    '# TYPE reconciler_divergences_total counter',
    `reconciler_divergences_total ${m.divergences_total}`,

    '# HELP reconciler_divergences_repaired_total Total divergences repaired since startup',
    '# TYPE reconciler_divergences_repaired_total counter',
    `reconciler_divergences_repaired_total ${m.divergences_repaired}`,

    '# HELP reconciler_ledger_gaps_detected_total Total ledger gaps detected',
    '# TYPE reconciler_ledger_gaps_detected_total counter',
    `reconciler_ledger_gaps_detected_total ${m.ledger_gaps_detected}`,

    '# HELP reconciler_ledger_gaps_backfilled_total Total ledger gaps backfilled',
    '# TYPE reconciler_ledger_gaps_backfilled_total counter',
    `reconciler_ledger_gaps_backfilled_total ${m.ledger_gaps_backfilled}`,

    '# HELP reconciler_last_run_timestamp_seconds Unix timestamp of the last reconciliation run',
    '# TYPE reconciler_last_run_timestamp_seconds gauge',
    `reconciler_last_run_timestamp_seconds ${m.last_run_timestamp_seconds}`,

    '# HELP reconciler_last_run_duration_ms Duration of the last reconciliation run in ms',
    '# TYPE reconciler_last_run_duration_ms gauge',
    `reconciler_last_run_duration_ms ${m.last_run_duration_ms}`,

    '# HELP reconciler_consecutive_divergent_cycles Consecutive cycles with divergence count > 0',
    '# TYPE reconciler_consecutive_divergent_cycles gauge',
    `reconciler_consecutive_divergent_cycles ${m.consecutive_divergent_cycles}`,
  ].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let scheduledTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Start the reconciler on a cron schedule.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startReconcilerSchedule(pool: Pool): void {
  if (scheduledTask) return;

  scheduledTask = cron.schedule(RECONCILER_CRON, async () => {
    try {
      await runReconciliationCycle(pool);
    } catch (err) {
      logger.error('Reconciliation cycle failed', { err });
    }
  });

  logger.info('Reconciler scheduled', { cron: RECONCILER_CRON });
}

/** Stop the reconciler (useful in tests and graceful shutdown). */
export function stopReconcilerSchedule(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}
