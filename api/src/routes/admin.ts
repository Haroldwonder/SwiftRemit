import { Router, Request, Response } from 'express';
import { ErrorResponse } from '../types';
import { Pool } from 'pg';
import { AdminConfirmationService, HighRiskOperation } from '../../../backend/src/admin-confirmation';

function timestamp(): string {
  return new Date().toISOString();
}

function sendError(res: Response, status: number, message: string, code: string): Response<ErrorResponse> {
  return res.status(status).json({ success: false, error: { message, code }, timestamp: timestamp() });
}

/** Validate a 32-byte WASM hash supplied as a 64-char hex string */
function isValidWasmHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Validate admin API key from the x-api-key header.
 * Returns true if the key matches the configured admin key.
 */
function isAdminAuthorized(req: Request): boolean {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return false;
  return req.headers['x-api-key'] === adminKey;
}

export interface IntegratorFeeEntry {
  integrator: string;
  accumulated_fees: number;
}

export interface FeeTimeSeries {
  period: 'daily' | 'weekly' | 'monthly';
  label: string;
  amount: number;
}

export interface FeeBreakdownData {
  total_accumulated_fees: number;
  pending_withdrawal: number;
  integrator_breakdown: IntegratorFeeEntry[];
  time_series: FeeTimeSeries[];
}

/**
 * Stub: in production this queries the contract via RPC and/or the event DB.
 */
function fetchFeeBreakdown(): FeeBreakdownData {
  return {
    total_accumulated_fees: 0,
    pending_withdrawal: 0,
    integrator_breakdown: [],
    time_series: [],
  };
}

/**
 * Simulate what a contract upgrade would do without applying any state changes.
 *
 * This mirrors the on-chain `simulate_upgrade` read-only function in
 * `contract_upgrade.rs`.  The API layer performs the same heuristic so callers
 * can preview migration impact before submitting a proposal.
 */
function simulateUpgrade(wasmHashHex: string): {
  current_schema_version: number;
  new_schema_version: number;
  schema_version_delta: number;
  estimated_migration_steps: number;
  affected_storage_keys: string[];
  requires_migration: boolean;
} {
  // In a production deployment this would query the live contract via RPC.
  // Here we use the same deterministic heuristic as the on-chain function so
  // the REST response is always consistent with what the contract would return.
  const CURRENT_SCHEMA_VERSION = parseInt(process.env.CONTRACT_SCHEMA_VERSION ?? '0', 10);
  const firstByte = parseInt(wasmHashHex.slice(0, 2), 16);
  const newSchemaVersion = CURRENT_SCHEMA_VERSION + 1 + (firstByte % 3);
  const delta = newSchemaVersion - CURRENT_SCHEMA_VERSION;
  const requiresMigration = delta > 0;

  const affectedKeys = requiresMigration
    ? ['schema_v', 'UpgradeKey::NextId', 'UpgradeKey::PendingCount']
    : [];

  return {
    current_schema_version: CURRENT_SCHEMA_VERSION,
    new_schema_version: newSchemaVersion,
    schema_version_delta: delta,
    estimated_migration_steps: Math.abs(delta),
    affected_storage_keys: affectedKeys,
    requires_migration: requiresMigration,
  };
}

const HIGH_RISK_OPS: HighRiskOperation[] = ['withdraw_fees', 'remove_agent', 'update_fee'];

function getConfirmationService(): AdminConfirmationService | null {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  const pool = new Pool({ connectionString: dbUrl });
  return new AdminConfirmationService(pool);
}

export function createAdminRouter(): Router {
  const router = Router();

  /**
   * @openapi
   * /api/admin/fees:
   *   get:
   *     summary: Get accumulated fee breakdown (admin only)
   *     description: >
   *       Returns total accumulated platform fees, per-integrator breakdown,
   *       daily/weekly/monthly time-series, and pending withdrawal amount.
   *       Requires admin authentication via x-api-key header.
   *     tags:
   *       - Admin
   *     security:
   *       - ApiKeyAuth: []
   *     responses:
   *       200:
   *         description: Fee breakdown data
   *       401:
   *         description: Unauthorized
   */
  router.get('/fees', (req: Request, res: Response) => {
    if (!isAdminAuthorized(req)) {
      return sendError(res, 401, 'Admin authentication required', 'UNAUTHORIZED');
    }

    const data = fetchFeeBreakdown();

    return res.json({
      success: true,
      data,
      timestamp: timestamp(),
    });
  });

  /**
   * @openapi
   * /api/admin/simulate-upgrade:
   *   post:
   *     summary: Simulate a contract upgrade (read-only)
   *     description: >
   *       Returns a preview of the storage migrations that would be applied if
   *       the supplied WASM hash were used in a real upgrade proposal.  No
   *       on-chain state is modified.
   *     tags:
   *       - Admin
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - wasm_hash
   *             properties:
   *               wasm_hash:
   *                 type: string
   *                 description: 64-character hex-encoded 32-byte WASM hash
   *                 example: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
   *     responses:
   *       200:
   *         description: Simulation result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     current_schema_version:
   *                       type: integer
   *                     new_schema_version:
   *                       type: integer
   *                     schema_version_delta:
   *                       type: integer
   *                     estimated_migration_steps:
   *                       type: integer
   *                     affected_storage_keys:
   *                       type: array
   *                       items:
   *                         type: string
   *                     requires_migration:
   *                       type: boolean
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       400:
   *         description: Invalid wasm_hash
   */
  router.post('/simulate-upgrade', (req: Request, res: Response) => {
    const { wasm_hash } = req.body as Record<string, unknown>;

    if (!isValidWasmHash(wasm_hash)) {
      return sendError(
        res,
        400,
        'wasm_hash must be a 64-character hex string (32 bytes)',
        'INVALID_WASM_HASH',
      );
    }

    const result = simulateUpgrade(wasm_hash);

    res.json({
      success: true,
      data: result,
      timestamp: timestamp(),
    });
  });

  // ── Multi-step admin confirmation (#481) ──────────────────────────────────

  /**
   * POST /api/admin/actions
   * Initiate a high-risk operation requiring a second admin to confirm.
   */
  router.post('/actions', async (req: Request, res: Response) => {
    if (!isAdminAuthorized(req)) {
      return sendError(res, 401, 'Admin authentication required', 'UNAUTHORIZED');
    }

    const { operation, initiated_by, params } = req.body as Record<string, unknown>;

    if (!operation || !HIGH_RISK_OPS.includes(operation as HighRiskOperation)) {
      return sendError(res, 400, `operation must be one of: ${HIGH_RISK_OPS.join(', ')}`, 'INVALID_OPERATION');
    }
    if (typeof initiated_by !== 'string' || !initiated_by) {
      return sendError(res, 400, 'initiated_by is required', 'MISSING_FIELD');
    }

    const svc = getConfirmationService();
    if (!svc) return sendError(res, 503, 'Database not configured', 'DB_UNAVAILABLE');

    try {
      await svc.initTable();
      const action = await svc.initiate(
        operation as HighRiskOperation,
        initiated_by,
        (params as Record<string, unknown>) ?? {}
      );
      return res.status(201).json({ success: true, data: action, timestamp: timestamp() });
    } catch (err) {
      return sendError(res, 500, err instanceof Error ? err.message : 'Failed to initiate action', 'INITIATE_FAILED');
    }
  });

  /**
   * GET /api/admin/actions
   * List all pending (unconfirmed, non-expired) high-risk actions.
   */
  router.get('/actions', async (req: Request, res: Response) => {
    if (!isAdminAuthorized(req)) {
      return sendError(res, 401, 'Admin authentication required', 'UNAUTHORIZED');
    }

    const svc = getConfirmationService();
    if (!svc) return sendError(res, 503, 'Database not configured', 'DB_UNAVAILABLE');

    try {
      await svc.initTable();
      const actions = await svc.listPending();
      return res.json({ success: true, data: actions, timestamp: timestamp() });
    } catch (err) {
      return sendError(res, 500, err instanceof Error ? err.message : 'Failed to list actions', 'LIST_FAILED');
    }
  });

  /**
   * POST /api/admin/actions/:id/confirm
   * Second admin confirms a pending high-risk action.
   */
  router.post('/actions/:id/confirm', async (req: Request, res: Response) => {
    if (!isAdminAuthorized(req)) {
      return sendError(res, 401, 'Admin authentication required', 'UNAUTHORIZED');
    }

    const { confirmed_by } = req.body as Record<string, unknown>;
    if (typeof confirmed_by !== 'string' || !confirmed_by) {
      return sendError(res, 400, 'confirmed_by is required', 'MISSING_FIELD');
    }

    const svc = getConfirmationService();
    if (!svc) return sendError(res, 503, 'Database not configured', 'DB_UNAVAILABLE');

    try {
      await svc.initTable();
      const action = await svc.confirm(req.params.id, confirmed_by);
      return res.json({ success: true, data: action, timestamp: timestamp() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Confirmation failed';
      const isNotFound = msg.includes('not found');
      const isExpired = msg.includes('expired');
      const isSelf = msg.includes('cannot confirm');
      const status = isNotFound ? 404 : isExpired || isSelf ? 409 : 500;
      return sendError(res, status, msg, 'CONFIRM_FAILED');
    }
  });

  return router;
}
