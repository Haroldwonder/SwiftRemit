/**
 * SR-112 — AML/CTF operations API.
 *
 * Surfaces the screening, monitoring, alert-review, SAR and retention controls
 * to the compliance team. Every mutating call must carry an officer identity in
 * `x-officer-id`; unattributable compliance actions are worthless in an
 * examination, so the middleware rejects rather than defaulting to 'anonymous'.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { validateRequest, validateQuery, validateParams } from '../middleware/validate';
import {
  AlertDispositionSchema,
  AlertIdParamSchema,
  AlertListQuerySchema,
  EvaluateTransferSchema,
  RescreenQuerySchema,
  RetentionEnforceSchema,
  RuleCodeParamSchema,
  RuleUpdateSchema,
  SarCreateSchema,
  SarIdParamSchema,
  SarListQuerySchema,
  SarTransitionSchema,
  ScreenSubjectSchema,
  ScreeningSubjectParamSchema,
  TravelRuleRecordSchema,
  TravelRuleTransactionParamSchema,
} from '../schemas/aml';
import {
  AlertDispositionError,
  alertQueueSummary,
  disposeAlert,
  getAlert,
  listAlerts,
} from '../aml/alerts';
import { SanctionsScreeningService } from '../aml/sanctions-screening';
import { TransactionMonitoringService } from '../aml/transaction-monitoring';
import { SarWorkflowError, SarWorkflowService } from '../aml/sar-workflow';
import { TravelRuleError, TravelRuleService, Transmitter } from '../aml/travel-rule';
import { RetentionService } from '../aml/retention';
import { AlertDisposition, AlertStatus, SubjectType } from '../aml/types';

export interface AmlRouterDeps {
  /** Injected in tests, and by the scheduler when a real transport exists. */
  transmitter?: Transmitter;
}

/** Officer identity, attached by requireOfficer. */
interface OfficerRequest extends Request {
  officerId?: string;
}

export function requireOfficer(req: OfficerRequest, res: Response, next: NextFunction): void {
  const officerId = (req.headers['x-officer-id'] as string | undefined)?.trim();
  if (!officerId) {
    res.status(403).json({
      error: 'Compliance actions require an officer identity in the x-officer-id header',
    });
    return;
  }
  req.officerId = officerId;
  next();
}

export function createAmlRouter(pool: Pool, deps: AmlRouterDeps = {}): Router {
  const router = Router();

  const screening = new SanctionsScreeningService(pool);
  const monitoring = new TransactionMonitoringService(pool);
  const sar = new SarWorkflowService(pool);
  const travelRule = new TravelRuleService(pool, deps.transmitter);
  const retention = new RetentionService(pool);

  function fail(res: Response, err: unknown, fallback: string): void {
    if (err instanceof AlertDispositionError) {
      res.status(err.code === 'not_found' ? 404 : 409).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof SarWorkflowError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'invalid_transition' ? 409 : 400;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof TravelRuleError) {
      res.status(err.code === 'not_found' ? 404 : 422).json({
        error: err.message,
        code: err.code,
        missing: err.missing,
      });
      return;
    }
    res.status(500).json({ error: fallback });
  }

  // ── Screening ─────────────────────────────────────────────────────────────

  // POST /api/aml/screening/screen — screen one subject (onboarding or manual)
  router.post(
    '/screening/screen',
    requireOfficer,
    validateRequest(ScreenSubjectSchema),
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as {
        subject_type: SubjectType;
        subject_id: string;
        name: string;
        country?: string;
        date_of_birth?: string;
        trigger: 'onboarding' | 'periodic' | 'manual' | 'transaction';
      };
      try {
        const result = await screening.screen(
          {
            subjectType: body.subject_type,
            subjectId: body.subject_id,
            name: body.name,
            country: body.country,
            dateOfBirth: body.date_of_birth,
          },
          body.trigger,
        );
        // 200 with an explicit decision — the caller gates onboarding on it.
        res.json({
          screening_id: result.screeningId,
          outcome: result.outcome,
          decision: result.decision,
          highest_score: result.highestScore,
          matches: result.matches,
          lists_screened: result.listsScreened,
          screened_at: result.screenedAt,
          next_screening_at: result.nextScreeningAt,
          alert_id: result.alertId ?? null,
        });
      } catch (err) {
        fail(res, err, 'Screening failed');
      }
    },
  );

  // GET /api/aml/screening/:subjectType/:subjectId — latest result
  router.get(
    '/screening/:subjectType/:subjectId',
    validateParams(ScreeningSubjectParamSchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const latest = await screening.latestFor(
          req.params.subjectType as SubjectType,
          req.params.subjectId,
        );
        if (!latest) {
          res.status(404).json({ error: 'Subject has never been screened' });
          return;
        }
        res.json(latest);
      } catch (err) {
        fail(res, err, 'Failed to fetch screening result');
      }
    },
  );

  // POST /api/aml/screening/rescreen-due — run the periodic rescreening cycle
  router.post(
    '/screening/rescreen-due',
    requireOfficer,
    validateQuery(RescreenQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const summary = await screening.runPeriodicRescreening(Number(req.query.limit));
        res.json(summary);
      } catch (err) {
        fail(res, err, 'Rescreening cycle failed');
      }
    },
  );

  // ── Monitoring ────────────────────────────────────────────────────────────

  // GET /api/aml/monitoring/rules
  router.get('/monitoring/rules', async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await monitoring.loadRules());
    } catch (err) {
      fail(res, err, 'Failed to load monitoring rules');
    }
  });

  // PATCH /api/aml/monitoring/rules/:code
  router.patch(
    '/monitoring/rules/:code',
    requireOfficer,
    validateParams(RuleCodeParamSchema),
    validateRequest(RuleUpdateSchema),
    async (req: Request, res: Response): Promise<void> => {
      const { enabled, severity, params } = req.body as {
        enabled?: boolean;
        severity?: string;
        params?: Record<string, unknown>;
      };
      try {
        const { rows } = await pool.query(
          `UPDATE aml_monitoring_rules
              SET enabled  = COALESCE($1, enabled),
                  severity = COALESCE($2, severity),
                  params   = COALESCE($3::jsonb, params),
                  updated_at = NOW()
            WHERE code = $4
            RETURNING *`,
          [
            enabled ?? null,
            severity ?? null,
            params ? JSON.stringify(params) : null,
            req.params.code,
          ],
        );
        if (!rows.length) {
          res.status(404).json({ error: 'Rule not found' });
          return;
        }
        res.json(rows[0]);
      } catch (err) {
        fail(res, err, 'Failed to update rule');
      }
    },
  );

  // POST /api/aml/monitoring/evaluate — evaluate one transfer against all rules
  router.post(
    '/monitoring/evaluate',
    requireOfficer,
    validateRequest(EvaluateTransferSchema),
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as {
        transaction_id: string;
        sender_address: string;
        amount: number;
        currency: string;
        corridor?: string;
        created_at?: string;
      };
      try {
        const result = await monitoring.evaluateTransfer({
          transactionId: body.transaction_id,
          senderAddress: body.sender_address,
          amount: body.amount,
          currency: body.currency.toUpperCase(),
          corridor: body.corridor?.toUpperCase() ?? null,
          createdAt: body.created_at ? new Date(body.created_at) : new Date(),
        });
        res.json({
          hits: result.hits,
          alert_ids: result.alertIds,
          unimplemented_rules: result.unimplemented,
        });
      } catch (err) {
        fail(res, err, 'Monitoring evaluation failed');
      }
    },
  );

  // ── Alert review queue ────────────────────────────────────────────────────

  // GET /api/aml/alerts/summary — must precede /alerts/:id
  router.get('/alerts/summary', async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await alertQueueSummary(pool));
    } catch (err) {
      fail(res, err, 'Failed to summarise alert queue');
    }
  });

  // GET /api/aml/alerts
  router.get(
    '/alerts',
    validateQuery(AlertListQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const q = req.query as Record<string, any>;
      try {
        const alerts = await listAlerts(pool, {
          status: q.status,
          severity: q.severity,
          ruleCode: q.rule_code,
          subjectId: q.subject_id,
          assignedTo: q.assigned_to,
          limit: Number(q.limit),
          offset: Number(q.offset),
        });
        res.json({ total: alerts.length, alerts });
      } catch (err) {
        fail(res, err, 'Failed to list alerts');
      }
    },
  );

  // GET /api/aml/alerts/:id
  router.get(
    '/alerts/:id',
    validateParams(AlertIdParamSchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const alert = await getAlert(pool, Number(req.params.id));
        if (!alert) {
          res.status(404).json({ error: 'Alert not found' });
          return;
        }
        res.json(alert);
      } catch (err) {
        fail(res, err, 'Failed to fetch alert');
      }
    },
  );

  // PATCH /api/aml/alerts/:id — record a disposition
  router.patch(
    '/alerts/:id',
    requireOfficer,
    validateParams(AlertIdParamSchema),
    validateRequest(AlertDispositionSchema),
    async (req: OfficerRequest, res: Response): Promise<void> => {
      const body = req.body as {
        status: AlertStatus;
        disposition?: AlertDisposition;
        notes?: string;
        assigned_to?: string;
      };
      try {
        const updated = await disposeAlert(pool, Number(req.params.id), {
          status: body.status,
          disposition: body.disposition,
          notes: body.notes,
          assignedTo: body.assigned_to,
          actor: req.officerId as string,
        });
        res.json(updated);
      } catch (err) {
        fail(res, err, 'Failed to update alert');
      }
    },
  );

  // ── SAR workflow ──────────────────────────────────────────────────────────

  // POST /api/aml/sar
  router.post(
    '/sar',
    requireOfficer,
    validateRequest(SarCreateSchema),
    async (req: OfficerRequest, res: Response): Promise<void> => {
      const body = req.body as {
        jurisdiction: string;
        subject_type: SubjectType;
        subject_id: string;
        alert_ids: number[];
        narrative: string;
        currency?: string;
      };
      try {
        const created = await sar.createFromAlerts({
          jurisdiction: body.jurisdiction,
          subjectType: body.subject_type,
          subjectId: body.subject_id,
          alertIds: body.alert_ids,
          narrative: body.narrative,
          currency: body.currency,
          preparedBy: req.officerId as string,
        });
        res.status(201).json(created);
      } catch (err) {
        fail(res, err, 'Failed to create SAR');
      }
    },
  );

  // GET /api/aml/sar
  router.get(
    '/sar',
    validateQuery(SarListQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const reports = await sar.list(req.query.status as any, Number(req.query.limit));
        res.json({ total: reports.length, reports });
      } catch (err) {
        fail(res, err, 'Failed to list SARs');
      }
    },
  );

  // GET /api/aml/sar/:id — report plus its full transition history
  router.get(
    '/sar/:id',
    validateParams(SarIdParamSchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = Number(req.params.id);
        const report = await sar.get(id);
        if (!report) {
          res.status(404).json({ error: 'SAR not found' });
          return;
        }
        res.json({ ...report, events: await sar.events(id) });
      } catch (err) {
        fail(res, err, 'Failed to fetch SAR');
      }
    },
  );

  // PATCH /api/aml/sar/:id — advance the workflow
  router.patch(
    '/sar/:id',
    requireOfficer,
    validateParams(SarIdParamSchema),
    validateRequest(SarTransitionSchema),
    async (req: OfficerRequest, res: Response): Promise<void> => {
      const body = req.body as { status: any; notes?: string; external_reference?: string };
      try {
        const updated = await sar.transition(
          Number(req.params.id),
          body.status,
          req.officerId as string,
          { notes: body.notes, externalReference: body.external_reference },
        );
        res.json(updated);
      } catch (err) {
        fail(res, err, 'Failed to transition SAR');
      }
    },
  );

  // ── Travel rule ───────────────────────────────────────────────────────────

  // POST /api/aml/travel-rule — record the obligation for a transfer
  router.post(
    '/travel-rule',
    requireOfficer,
    validateRequest(TravelRuleRecordSchema),
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as {
        transaction_id: string;
        jurisdiction: string;
        amount: number;
        currency: string;
        amount_usd: number;
        originator?: Record<string, string | undefined>;
        beneficiary?: Record<string, string | undefined>;
        counterparty_vasp?: string;
      };
      try {
        const result = await travelRule.record({
          transactionId: body.transaction_id,
          jurisdiction: body.jurisdiction,
          amount: body.amount,
          currency: body.currency,
          amountUsd: body.amount_usd,
          originator: body.originator
            ? {
                name: body.originator.name as string,
                accountIdentifier: body.originator.account_identifier as string,
                address: body.originator.address,
                nationalIdentifier: body.originator.national_identifier,
                dateOfBirth: body.originator.date_of_birth,
                placeOfBirth: body.originator.place_of_birth,
                country: body.originator.country,
              }
            : undefined,
          beneficiary: body.beneficiary
            ? {
                name: body.beneficiary.name as string,
                accountIdentifier: body.beneficiary.account_identifier as string,
                country: body.beneficiary.country,
              }
            : undefined,
          counterpartyVasp: body.counterparty_vasp,
        });
        res.status(201).json({
          id: result.id,
          required: result.required,
          threshold_applied: result.threshold,
          transmission_status: result.transmissionStatus,
        });
      } catch (err) {
        fail(res, err, 'Failed to record travel-rule data');
      }
    },
  );

  // POST /api/aml/travel-rule/:transactionId/transmit
  router.post(
    '/travel-rule/:transactionId/transmit',
    requireOfficer,
    validateParams(TravelRuleTransactionParamSchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const result = await travelRule.transmitOne(req.params.transactionId);
        res.status(result.status === 'transmitted' ? 200 : 502).json(result);
      } catch (err) {
        fail(res, err, 'Travel-rule transmission failed');
      }
    },
  );

  // ── Retention ─────────────────────────────────────────────────────────────

  // GET /api/aml/retention/status
  router.get('/retention/status', async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await retention.status());
    } catch (err) {
      fail(res, err, 'Failed to load retention status');
    }
  });

  // POST /api/aml/retention/enforce — run now (also runs nightly via scheduler)
  router.post(
    '/retention/enforce',
    requireOfficer,
    validateRequest(RetentionEnforceSchema),
    async (req: Request, res: Response): Promise<void> => {
      const entity = (req.body as { entity?: string }).entity;
      try {
        if (entity) {
          const policies = await retention.loadPolicies();
          const policy = policies.find((p) => p.entity === entity);
          if (!policy) {
            res.status(404).json({ error: `No retention policy for entity '${entity}'` });
            return;
          }
          res.json([await retention.enforcePolicy(policy)]);
          return;
        }
        res.json(await retention.enforceAll());
      } catch (err) {
        fail(res, err, 'Retention enforcement failed');
      }
    },
  );

  return router;
}
