import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { getFxRateCache } from '../fx-rate-cache';
import { simulateSettlement } from '../stellar';
import { saveContractEvent, queryContractEvents } from '../database';
import { remittanceEventEmitter } from '../remittance/events';
import { AuthenticatedRequest, createTransferGuard } from '../transfer-guard';
import { KycUpsertService } from '../kyc-upsert-service';
import { createLogger } from '../correlation-id';
import { sanitizeInput } from '../sanitizer';
import { TransactionMonitoringService } from '../aml/transaction-monitoring';
import { OriginatorData, BeneficiaryData, TravelRuleService } from '../aml/travel-rule';

const logger = createLogger('routes/remittance');

function toOriginatorData(raw: unknown): OriginatorData | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== 'string' || typeof o.account_identifier !== 'string') return undefined;
  return {
    name: o.name,
    accountIdentifier: o.account_identifier,
    address: typeof o.address === 'string' ? o.address : undefined,
    nationalIdentifier: typeof o.national_identifier === 'string' ? o.national_identifier : undefined,
    dateOfBirth: typeof o.date_of_birth === 'string' ? o.date_of_birth : undefined,
    placeOfBirth: typeof o.place_of_birth === 'string' ? o.place_of_birth : undefined,
    country: typeof o.country === 'string' ? o.country : undefined,
  };
}

function toBeneficiaryData(raw: unknown): BeneficiaryData | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const b = raw as Record<string, unknown>;
  if (typeof b.name !== 'string' || typeof b.account_identifier !== 'string') return undefined;
  return {
    name: b.name,
    accountIdentifier: b.account_identifier,
    country: typeof b.country === 'string' ? b.country : undefined,
  };
}

/**
 * Run AML transaction monitoring and travel-rule assessment for a newly
 * created remittance. Mirrors the existing autoFlagIfAboveThreshold pattern:
 * best-effort, logged, and never allowed to fail the remittance response —
 * but unlike the threshold check, this is the only place structuring,
 * velocity, corridor and travel-rule obligations are evaluated for a
 * transfer created through the live API (see SR-112 audit).
 */
async function runAmlChecks(
  pool: Pool,
  monitoring: TransactionMonitoringService,
  travelRule: TravelRuleService,
  params: {
    remittanceId: string;
    sender: string;
    amount: number;
    currency: string;
    corridor: string | null;
    jurisdiction?: string;
    originator?: unknown;
    beneficiary?: unknown;
    counterpartyVasp?: string;
  },
): Promise<void> {
  try {
    await monitoring.evaluateTransfer({
      transactionId: params.remittanceId,
      senderAddress: params.sender,
      amount: params.amount,
      currency: params.currency,
      corridor: params.corridor,
      createdAt: new Date(),
    });
  } catch (error) {
    logger.error(
      'Transaction monitoring evaluation failed',
      error instanceof Error ? error : new Error(String(error)),
      { remittanceId: params.remittanceId },
    );
  }

  try {
    await travelRule.assess({
      transactionId: params.remittanceId,
      jurisdiction: params.jurisdiction ?? 'DEFAULT',
      amount: params.amount,
      currency: params.currency,
      amountUsd: params.amount,
      originator: toOriginatorData(params.originator),
      beneficiary: toBeneficiaryData(params.beneficiary),
      counterpartyVasp: params.counterpartyVasp,
    });
  } catch (error) {
    logger.error(
      'Travel-rule assessment failed',
      error instanceof Error ? error : new Error(String(error)),
      { remittanceId: params.remittanceId },
    );
  }
}

function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = (req.headers['x-user-id'] as string) || '';
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  req.user = { id: userId };
  next();
}

export function createRemittanceRouter(pool: Pool): Router {
  const router = Router();
  const fxRateCache = getFxRateCache();
  const monitoring = new TransactionMonitoringService(pool);
  const travelRule = new TravelRuleService(pool);
  // Same KycUpsertService construction pattern as routes/kyc.ts, so the
  // guard below applies to the real money-movement entry point and not just
  // the /api/transfer stub.
  const kycUpsertService = new KycUpsertService(pool);
  const transferGuard = createTransferGuard(kycUpsertService);

  // Register the contract-event persistence listener once at router creation time.
  // The listener is idempotent because it only writes; registering it here keeps
  // the side-effect co-located with the remittance domain.
  remittanceEventEmitter.onStatusChange(async (event) => {
    try {
      await saveContractEvent({
        event_type: event.status,
        remittance_id: event.remittanceId ? parseInt(event.remittanceId, 10) : null,
        actor: event.recipientId || null,
        amount: event.amount?.toString() ?? null,
        fee: null,
        tx_hash: (event.metadata?.txHash as string) ?? null,
        ledger_sequence: (event.metadata?.ledgerSequence as number) ?? null,
        timestamp: event.timestamp,
        raw_data: event.metadata ?? null,
      });
    } catch (err) {
      logger.error('Failed to persist contract event', err instanceof Error ? err : new Error(String(err)));
    }
  });

  // POST /api/remittance
  // transferGuard enforces KYC approval/expiry/re-verification-pending checks
  // before this handler is allowed to insert a real transactions row — the
  // only place those checks were previously applied was the unrelated
  // /api/transfer no-op stub in routes/kyc.ts, so this was reachable by any
  // caller with an arbitrary x-user-id header regardless of KYC status.
  router.post('/remittance', authMiddleware, transferGuard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { sender, agent, amount, fee, expiry, memo } = req.body;
      const fromCurrency = typeof req.body.fromCurrency === 'string' ? req.body.fromCurrency : req.body.from_currency;
      const toCurrency = typeof req.body.toCurrency === 'string' ? req.body.toCurrency : req.body.to_currency;
      const maxStalenessSeconds = Number.parseInt(
        String(req.body.fxRateMaxStalenessSeconds ?? req.body.fx_rate_max_staleness_seconds ?? process.env.FX_RATE_MAX_STALENESS_SECONDS ?? '3600'),
        10,
      );

      if (!sender || typeof sender !== 'string') return res.status(400).json({ error: 'Invalid or missing sender' });
      if (!agent || typeof agent !== 'string') return res.status(400).json({ error: 'Invalid or missing agent' });
      if (!amount || typeof amount !== 'string' || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Invalid or missing amount' });

      let sanitizedMemo: string | undefined;
      if (memo !== undefined && memo !== null && memo !== '') {
        if (typeof memo !== 'string') return res.status(400).json({ error: 'memo must be a string' });
        if (memo.length > 100) return res.status(400).json({ error: 'memo must not exceed 100 characters' });
        sanitizedMemo = sanitizeInput(memo);
      }

      if (typeof fromCurrency === 'string' && fromCurrency && typeof toCurrency === 'string' && toCurrency) {
        try {
          const fxRate = await fxRateCache.getCurrentRate(fromCurrency.toUpperCase(), toCurrency.toUpperCase());
          if (fxRate.stale && typeof fxRate.stalenessSeconds === 'number' && fxRate.stalenessSeconds > (Number.isFinite(maxStalenessSeconds) ? maxStalenessSeconds : 3600)) {
            return res.status(409).json({
              error: `FX rate is stale beyond the allowed maximum (${Number.isFinite(maxStalenessSeconds) ? maxStalenessSeconds : 3600}s)`,
              fx_rate_source: fxRate.fx_rate_source || fxRate.provider,
              fx_rate_staleness_seconds: fxRate.stalenessSeconds,
            });
          }
        } catch (error) {
          logger.error('Failed to resolve FX rate for remittance', error instanceof Error ? error : new Error(String(error)));
          return res.status(503).json({ error: 'Unable to obtain a valid FX rate' });
        }
      }

      const remittanceId = `rem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await pool.query(
        `INSERT INTO transactions (transaction_id, anchor_id, kind, status, amount_in, memo, created_at, updated_at)
         VALUES ($1, $2, 'withdrawal', 'pending_user_transfer_start', $3, $4, NOW(), NOW())`,
        [remittanceId, agent, amount, sanitizedMemo ?? null],
      );

      try {
        const { autoFlagIfAboveThreshold } = await import('./compliance');
        await autoFlagIfAboveThreshold(pool, remittanceId, parseFloat(amount), 'USD');
      } catch { /* compliance tables may not exist in all environments */ }

      // SR-112: run structuring/velocity/corridor monitoring and travel-rule
      // assessment synchronously so every remittance created through this
      // endpoint is actually screened — not just ones a compliance officer
      // happens to POST to /api/aml/... by hand.
      await runAmlChecks(pool, monitoring, travelRule, {
        remittanceId,
        sender,
        amount: parseFloat(amount),
        currency: (toCurrency || fromCurrency || 'USD').toUpperCase(),
        corridor: fromCurrency && toCurrency ? `${fromCurrency.toUpperCase()}-${toCurrency.toUpperCase()}` : null,
        jurisdiction: typeof req.body.jurisdiction === 'string' ? req.body.jurisdiction : undefined,
        originator: req.body.originator,
        beneficiary: req.body.beneficiary,
        counterpartyVasp: typeof req.body.counterparty_vasp === 'string' ? req.body.counterparty_vasp : undefined,
      });

      return res.status(201).json({
        success: true,
        remittance: {
          remittance_id: remittanceId,
          sender,
          agent,
          amount,
          fee: fee ?? null,
          expiry: expiry ?? null,
          memo: sanitizedMemo ?? null,
          status: 'pending_user_transfer_start',
        },
      });
    } catch (error) {
      logger.error('Error creating remittance', error instanceof Error ? error : new Error(String(error)));
      return res.status(500).json({ error: 'Failed to create remittance' });
    }
  });

  // GET /api/remittance/:remittanceId
  router.get('/remittance/:remittanceId', async (req: Request, res: Response) => {
    try {
      const { remittanceId } = req.params;
      const result = await pool.query(
        `SELECT transaction_id, anchor_id, status, amount_in, memo, created_at, updated_at
         FROM transactions WHERE transaction_id = $1`,
        [remittanceId],
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Remittance not found' });
      const row = result.rows[0];
      return res.json({
        remittance_id: row.transaction_id,
        agent: row.anchor_id,
        status: row.status,
        amount: row.amount_in,
        memo: row.memo ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    } catch (error) {
      logger.error('Error fetching remittance', error instanceof Error ? error : new Error(String(error)));
      return res.status(500).json({ error: 'Failed to fetch remittance' });
    }
  });

  // POST /api/simulate-settlement
  router.post('/simulate-settlement', async (req: Request, res: Response) => {
    try {
      const { remittanceId } = req.body;
      if (remittanceId === undefined || remittanceId === null || !Number.isInteger(remittanceId) || remittanceId <= 0) {
        return res.status(400).json({ error: 'remittanceId must be a positive integer' });
      }
      const simulation = await simulateSettlement(remittanceId);
      res.json(simulation);
    } catch (error) {
      console.error('Error simulating settlement:', error);
      res.status(500).json({ error: 'Failed to simulate settlement' });
    }
  });

  // GET /api/events
  router.get('/events', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const filter = {
        event_type: req.query.event_type as string | undefined,
        actor: req.query.actor as string | undefined,
        remittance_id: req.query.remittance_id ? parseInt(req.query.remittance_id as string, 10) : undefined,
        from: req.query.from ? new Date(req.query.from as string) : undefined,
        to: req.query.to ? new Date(req.query.to as string) : undefined,
        limit,
        offset,
      };
      const { events, total } = await queryContractEvents(filter);
      res.json({ total, limit, offset, events });
    } catch (error) {
      logger.error('Error fetching contract events', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to fetch contract events' });
    }
  });

  return router;
}
