import { Router, Request, Response } from 'express';
import { ErrorResponse } from '../types';
import { Pool } from 'pg';
import { AdminConfirmationService, HighRiskOperation } from '../admin-confirmation';
import axios from 'axios';

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
   *     summary: Simulate a contract upgrade (read-only, requires 2FA)
   *     description: >
   *       Returns a preview of the storage migrations that would be applied if
   *       the supplied WASM hash were used in a real upgrade proposal.  No
   *       on-chain state is modified. Requires admin API key and a valid
   *       confirmation token from a second admin.
   *     tags:
   *       - Admin
   *     security:
   *       - ApiKeyAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - wasm_hash
   *               - confirmation_token
   *             properties:
   *               wasm_hash:
   *                 type: string
   *                 description: 64-character hex-encoded 32-byte WASM hash
   *                 example: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
   *               confirmation_token:
   *                 type: string
   *                 description: Confirmation token from second admin
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
   *         description: Invalid wasm_hash or missing confirmation_token
   *       401:
   *         description: Unauthorized or invalid confirmation token
   */
  router.post('/simulate-upgrade', async (req: Request, res: Response) => {
    if (!isAdminAuthorized(req)) {
      return sendError(res, 401, 'Admin authentication required', 'UNAUTHORIZED');
    }

    const { wasm_hash, confirmation_token } = req.body as Record<string, unknown>;

    if (!confirmation_token || typeof confirmation_token !== 'string') {
      return sendError(
        res,
        400,
        'confirmation_token is required for this high-risk operation',
        'MISSING_CONFIRMATION_TOKEN',
      );
    }

    if (!isValidWasmHash(wasm_hash)) {
      return sendError(
        res,
        400,
        'wasm_hash must be a 64-character hex string (32 bytes)',
        'INVALID_WASM_HASH',
      );
    }

    // Verify the confirmation token
    const svc = getConfirmationService();
    if (!svc) {
      return sendError(res, 503, 'Database not configured', 'DB_UNAVAILABLE');
    }

    try {
      await svc.initTable();
      const action = await svc.verify(confirmation_token);

      if (!action) {
        return sendError(res, 401, 'Invalid or expired confirmation token', 'INVALID_CONFIRMATION_TOKEN');
      }

      // Token is valid, proceed with simulation
      const result = simulateUpgrade(wasm_hash);

      res.json({
        success: true,
        data: result,
        timestamp: timestamp(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Confirmation verification failed';
      return sendError(res, 401, msg, 'CONFIRMATION_VERIFICATION_FAILED');
    }
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

  /**
   * GET /api/admin/anchors/:id/health
   * Returns anchor health status, history, and uptime percentage.
   */
  router.get('/anchors/:id/health', async (req: Request, res: Response) => {
    if (!isAdminAuthorized(req)) {
      return sendError(res, 401, 'Admin authentication required', 'UNAUTHORIZED');
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      return sendError(res, 503, 'Database not configured', 'DB_UNAVAILABLE');
    }

    const pool = new Pool({ connectionString: dbUrl });
    try {
      const { id } = req.params;

      const anchorResult = await pool.query(
        `SELECT id, name, domain, home_domain, enabled FROM anchors WHERE id = $1`,
        [id]
      );

      if (anchorResult.rows.length === 0) {
        return sendError(res, 404, `Anchor with id '${id}' not found`, 'ANCHOR_NOT_FOUND');
      }

      const anchor = anchorResult.rows[0];

      const latestResult = await pool.query(
        `SELECT id, anchor_id, status, response_time_ms, error_message, checked_at
         FROM anchor_health_history
         WHERE anchor_id = $1
         ORDER BY checked_at DESC
         LIMIT 1`,
        [id]
      );

      const historyResult = await pool.query(
        `SELECT id, anchor_id, status, response_time_ms, error_message, checked_at
         FROM anchor_health_history
         WHERE anchor_id = $1
         ORDER BY checked_at DESC
         LIMIT 50`,
        [id]
      );

      const uptimeResult = await pool.query(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online
         FROM anchor_health_history
         WHERE anchor_id = $1 AND checked_at > NOW() - INTERVAL '24 hours'`,
        [id]
      );

      const total = parseInt(uptimeResult.rows[0].total, 10);
      const online = parseInt(uptimeResult.rows[0].online, 10);
      const uptimePercentage = total > 0 ? Math.round((online / total) * 100 * 100) / 100 : 100;

      const currentStatus = latestResult.rows[0]
        ? {
            status: latestResult.rows[0].status,
            response_time_ms: latestResult.rows[0].response_time_ms,
            error_message: latestResult.rows[0].error_message,
            checked_at: latestResult.rows[0].checked_at,
          }
        : null;

      const history = historyResult.rows.map(row => ({
        status: row.status,
        response_time_ms: row.response_time_ms,
        error_message: row.error_message,
        checked_at: row.checked_at,
      }));

      res.json({
        success: true,
        data: {
          anchor_id: id,
          anchor_name: anchor.name,
          domain: anchor.domain,
          current_status: currentStatus,
          history,
          uptime_percentage_24h: uptimePercentage,
        },
        timestamp: timestamp(),
      });
    } catch (error) {
      return sendError(
        res,
        500,
        error instanceof Error ? error.message : 'Failed to retrieve anchor health',
        'ANCHOR_HEALTH_ERROR',
      );
    } finally {
      await pool.end();
    }
  });

  // ── Dead-Letter Queue (DLQ) Management (#851) ─────────────────────────────────

  /**
   * GET /api/admin/webhooks/dlq
   * List dead-letter queue entries with pagination.
   */
  router.get('/webhooks/dlq', async (req: Request, res: Response) => {
    if (!isAdminAuthorized(req)) {
      return sendError(res, 401, 'Admin authentication required', 'UNAUTHORIZED');
    }

    const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
    if (!pool) {
      return sendError(res, 503, 'Database not configured', 'DB_UNAVAILABLE');
    }

    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 100);
    const offset = parseInt(String(req.query.offset || '0'), 10);

    try {
      const result = await pool.query(
        `SELECT id, delivery_id, webhook_id, event_type, payload, last_error, attempts, created_at, replayed_at
         FROM webhook_dead_letters
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const entries = result.rows.map(row => ({
        id: row.id,
        deliveryId: row.delivery_id,
        webhookId: row.webhook_id,
        eventType: row.event_type,
        payload: row.payload,
        lastError: row.last_error,
        attempts: row.attempts,
        createdAt: row.created_at,
        replayedAt: row.replayed_at,
      }));

      return res.json({ success: true, data: entries, timestamp: timestamp() });
    } catch (err) {
      return sendError(res, 500, err instanceof Error ? err.message : 'Failed to list dead letters', 'DLQ_LIST_FAILED');
    } finally {
      await pool.end();
    }
  });

  /**
   * POST /api/admin/webhooks/dlq/:id/replay
   * Replay a dead-letter queue entry by re-delivering to the original webhook.
   */
  router.post('/webhooks/dlq/:id/replay', async (req: Request, res: Response) => {
    if (!isAdminAuthorized(req)) {
      return sendError(res, 401, 'Admin authentication required', 'UNAUTHORIZED');
    }

    const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
    if (!pool) {
      return sendError(res, 503, 'Database not configured', 'DB_UNAVAILABLE');
    }

    const entryId = req.params.id;

    try {
      // Get the dead-letter entry
      const entryResult = await pool.query(
        `SELECT id, delivery_id, webhook_id, event_type, payload, last_error, attempts
         FROM webhook_dead_letters
         WHERE id = $1 AND replayed_at IS NULL`,
        [entryId]
      );

      if (entryResult.rows.length === 0) {
        return sendError(res, 404, 'Dead-letter entry not found or already replayed', 'DLQ_ENTRY_NOT_FOUND');
      }

      const entry = entryResult.rows[0];

      // Get the webhook URL
      const webhookResult = await pool.query(
        `SELECT id, url, secret FROM webhooks WHERE id = $1 AND active = TRUE`,
        [entry.webhook_id]
      );

      if (webhookResult.rows.length === 0) {
        return sendError(res, 404, 'Webhook not found or inactive', 'WEBHOOK_NOT_FOUND');
      }

      const webhook = webhookResult.rows[0];

      // Re-deliver the webhook
      const payloadStr = JSON.stringify(entry.payload);
      const timestamp = Date.now().toString();
      const signature = require('crypto')
        .createHmac('sha256', webhook.secret || '')
        .update(`${timestamp}.${payloadStr}`)
        .digest('hex');

      let delivered = false;
      let errorMsg = null;

      try {
        const response = await axios.post(webhook.url, entry.payload, {
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-signature': signature,
            'x-webhook-timestamp': timestamp,
            'x-webhook-id': `replay_${Date.now()}`,
            'User-Agent': 'SwiftRemit-Webhook/1.0',
          },
          timeout: 30000,
          validateStatus: () => true,
        });

        delivered = response.status >= 200 && response.status < 300;
        if (!delivered) {
          errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
      }

      // Mark as replayed
      if (delivered) {
        await pool.query(
          `UPDATE webhook_dead_letters
           SET replayed_at = NOW(), replayed_by = $2
           WHERE id = $1`,
          [entryId, 'admin']
        );

        return res.json({ success: true, data: { replayed: true }, timestamp: timestamp() });
      } else {
        // Update with new error and increment attempts
        await pool.query(
          `UPDATE webhook_dead_letters
           SET last_error = $2, attempts = attempts + 1
           WHERE id = $1`,
          [entryId, errorMsg]
        );

        return sendError(res, 500, `Replay failed: ${errorMsg}`, 'DLQ_REPLAY_FAILED');
      }
    } catch (err) {
      return sendError(res, 500, err instanceof Error ? err.message : 'Failed to replay dead letter', 'DLQ_REPLAY_ERROR');
    } finally {
      await pool.end();
    }
  });

  return router;
}
