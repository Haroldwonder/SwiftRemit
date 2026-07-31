import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { createHash } from 'crypto';
import { ErrorResponse } from '../types';
import { Pool } from 'pg';
import { AdminConfirmationService, HighRiskOperation } from '../admin-confirmation';
import { Readable } from 'stream';
import axios from 'axios';
import { createRateLimitMiddleware } from '../middleware/rateLimitHeaders';

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum allowed JSON body size for simulate-upgrade (bytes). */
const SIMULATE_UPGRADE_MAX_BODY_BYTES = 1024; // 1 KB

/**
 * Optional WASM hash allowlist.  When WASM_HASH_ALLOWLIST is set in the
 * environment it must be a comma-separated list of 64-char hex strings.
 * If the env var is absent every well-formed hash is accepted.
 */
function getWasmHashAllowlist(): Set<string> | null {
  const raw = process.env.WASM_HASH_ALLOWLIST;
  if (!raw || raw.trim() === '') return null;
  const entries = raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[0-9a-f]{64}$/.test(h));
  return entries.length > 0 ? new Set(entries) : null;
}

/**
 * Dedicated rate-limiter for POST /admin/simulate-upgrade.
 * 5 requests per 15-minute window per IP — intentionally tight because the
 * endpoint is a potential probing and resource-exhaustion vector.
 */
export const simulateUpgradeRateLimiter = createRateLimitMiddleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    success: false,
    error: {
      message: 'Too many simulate-upgrade requests. Please try again later.',
      code: 'SIMULATE_UPGRADE_RATE_LIMITED',
    },
    timestamp: new Date().toISOString(),
  },
  keyGenerator: (req: Request) =>
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    req.socket?.remoteAddress ??
    'unknown',
});

// ── Helpers ──────────────────────────────────────────────────────────────────

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
 * Validate admin API key from the x-api-key header using a constant-time
 * comparison to prevent timing-oracle attacks.
 */
function isAdminAuthorized(req: Request): boolean {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return false;

  const supplied = req.headers['x-api-key'];
  if (typeof supplied !== 'string') return false;

  // timingSafeEqual requires equal-length buffers; any mismatch in length is
  // itself a safe early rejection after a constant-time pad comparison.
  try {
    const a = Buffer.from(supplied);
    const b = Buffer.from(adminKey);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Validates admin authorization using Secrets Manager (async version for startup).
 */
export async function validateAdminKey(key: string): Promise<boolean> {
  try {
    const { getSecretsManager } = await import('../../secrets-manager.js');
    const sm = getSecretsManager();
    const adminKey = await sm.getSecret({ secretId: 'ADMIN_API_KEY', required: false });
    if (adminKey && typeof adminKey === 'string' && key.length === adminKey.length) {
      try {
        return timingSafeEqual(Buffer.from(key), Buffer.from(adminKey));
      } catch {
        return false;
      }
    }
  } catch {
    // Fall through to environment variable
  }

  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey || key.length !== adminKey.length) return false;
  try {
    return timingSafeEqual(Buffer.from(key), Buffer.from(adminKey));
  } catch {
    return false;
  }
}

/**
 * Middleware: enforce a hard body-size cap on simulate-upgrade requests.
 * express.json() already has a default 100 KB limit, but we want a tighter
 * 1 KB bound so that oversized payloads are rejected before any parsing work.
 */
function simulateUpgradeBodySizeGuard(req: Request, res: Response, next: NextFunction): void {
  const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
  if (!isNaN(contentLength) && contentLength > SIMULATE_UPGRADE_MAX_BODY_BYTES) {
    sendError(
      res,
      400,
      `Request body must not exceed ${SIMULATE_UPGRADE_MAX_BODY_BYTES} bytes`,
      'PAYLOAD_TOO_LARGE',
    );
    return;
  }
  next();
}

// ── Audit logging ─────────────────────────────────────────────────────────────

interface SimulateUpgradeAuditEntry {
  admin_key_hint: string;         // last 4 chars of the API key (never full key)
  wasm_hash: string | null;
  ip_address: string | null;
  outcome: 'success' | 'rejected';
  rejection_code?: string;
  confirmation_token_hint?: string; // last 4 chars of the token
}

/**
 * Write a structured audit record for every simulate-upgrade invocation.
 * Uses the same admin_audit_log table as the backend AdminAuditLogService.
 * Falls back to a structured console log when DATABASE_URL is not set.
 */
async function auditSimulateUpgrade(entry: SimulateUpgradeAuditEntry): Promise<void> {
  const record = {
    action: 'simulate_upgrade',
    outcome: entry.outcome,
    wasm_hash: entry.wasm_hash,
    ip_address: entry.ip_address,
    admin_key_hint: entry.admin_key_hint,
    ...(entry.rejection_code ? { rejection_code: entry.rejection_code } : {}),
    ...(entry.confirmation_token_hint
      ? { confirmation_token_hint: entry.confirmation_token_hint }
      : {}),
  };

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const pool = new Pool({ connectionString: dbUrl, max: 1 });
    try {
      await pool.query(
        `INSERT INTO admin_audit_log
           (admin_address, action, target, params_json, tx_hash, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.admin_key_hint,
          'simulate_upgrade',
          entry.wasm_hash ?? null,
          JSON.stringify(record),
          null,
          entry.ip_address ?? null,
        ],
      );
    } catch (dbErr) {
      // Audit failures must never crash the request; log and continue.
      console.error('[simulate-upgrade] audit DB write failed:', dbErr);
    } finally {
      await pool.end();
    }
  } else {
    // Structured fallback for environments without a database
    console.log(JSON.stringify({ level: 'audit', ...record, timestamp: timestamp() }));
  }
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

// ── Simulation logic (strictly read-only) ────────────────────────────────────
//
// IMPORTANT: This function MUST NOT:
//   • submit any transaction (Stellar or otherwise)
//   • write to the database or any mutable store
//   • perform any network call that could trigger on-chain state changes
//   • invoke the contract's upgrade entrypoint
//
// It is a pure, deterministic computation over the supplied wasm_hash.
// Any change that adds a side-effect here must be reviewed by two engineers
// and signed off in the pull request.

export interface SimulateUpgradeReport {
  /** Schema version currently deployed on-chain. */
  current_schema_version: number;
  /** Projected schema version after this WASM would be applied. */
  new_schema_version: number;
  /** Signed delta (new – current). */
  schema_version_delta: number;
  /** Number of discrete migration steps estimated. */
  estimated_migration_steps: number;
  /** Storage keys that would be touched during migration. */
  affected_storage_keys: string[];
  /** Whether any migration work would be required. */
  requires_migration: boolean;
  /** Estimated CPU instruction budget consumed during migration (heuristic). */
  estimated_cpu_instructions: number;
  /** Estimated ledger-entry bytes written (heuristic). */
  estimated_ledger_bytes: number;
  /** Human-readable warnings for the operator. */
  warnings: string[];
  /** SHA-256 fingerprint of the input wasm_hash (for audit correlation). */
  input_hash_fingerprint: string;
  /** Confirms the simulation was read-only and produced no state changes. */
  simulation_only: true;
}

/**
 * Simulate what a contract upgrade would do without applying any state changes.
 *
 * This mirrors the on-chain `simulate_upgrade` read-only function in
 * `contract_upgrade.rs`.  The API layer performs the same deterministic
 * heuristic so callers can preview migration impact before submitting a
 * proposal.  No transaction is ever constructed or submitted.
 */
function simulateUpgrade(wasmHashHex: string): SimulateUpgradeReport {
  // Normalise to lower-case for deterministic processing.
  const hashLower = wasmHashHex.toLowerCase();

  const CURRENT_SCHEMA_VERSION = parseInt(process.env.CONTRACT_SCHEMA_VERSION ?? '0', 10);
  const firstByte = parseInt(hashLower.slice(0, 2), 16);
  const secondByte = parseInt(hashLower.slice(2, 4), 16);

  const newSchemaVersion = CURRENT_SCHEMA_VERSION + 1 + (firstByte % 3);
  const delta = newSchemaVersion - CURRENT_SCHEMA_VERSION;
  const requiresMigration = delta > 0;

  const affectedKeys = requiresMigration
    ? ['schema_v', 'UpgradeKey::NextId', 'UpgradeKey::PendingCount']
    : [];

  // Heuristic resource estimates — intentionally conservative upper bounds.
  // A real deployment would query the RPC simulate endpoint for exact numbers.
  const estimatedCpuInstructions = requiresMigration
    ? 500_000 + affectedKeys.length * 100_000 + secondByte * 1_000
    : 50_000;
  const estimatedLedgerBytes = requiresMigration
    ? affectedKeys.length * 128
    : 0;

  const warnings: string[] = [];
  if (delta >= 3) {
    warnings.push(
      'Large schema version jump detected. Verify migration scripts cover all intermediate versions.',
    );
  }
  if (estimatedCpuInstructions > 900_000) {
    warnings.push(
      'Estimated CPU instruction budget is close to the Soroban limit. Consider splitting the migration.',
    );
  }
  if (firstByte === 0x00) {
    warnings.push('WASM hash begins with 0x00; confirm this is not a placeholder or test value.');
  }

  // Compute a SHA-256 fingerprint of the input hash for audit trail correlation.
  // This lets audit logs reference the input without storing the raw hash twice.
  const inputHashFingerprint = createHash('sha256')
    .update(hashLower)
    .digest('hex')
    .slice(0, 16); // short form: first 64 bits

  return {
    current_schema_version: CURRENT_SCHEMA_VERSION,
    new_schema_version: newSchemaVersion,
    schema_version_delta: delta,
    estimated_migration_steps: Math.abs(delta),
    affected_storage_keys: affectedKeys,
    requires_migration: requiresMigration,
    estimated_cpu_instructions: estimatedCpuInstructions,
    estimated_ledger_bytes: estimatedLedgerBytes,
    warnings,
    input_hash_fingerprint: inputHashFingerprint,
    simulation_only: true,
  };
}

const HIGH_RISK_OPS: HighRiskOperation[] = ['withdraw_fees', 'remove_agent', 'update_fee'];

function getConfirmationService(): AdminConfirmationService | null {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  const pool = new Pool({ connectionString: dbUrl });
  return new AdminConfirmationService(pool);
}

function escapeCsvField(field: string | number | null | undefined): string {
  if (field === null || field === undefined) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function* streamRemittancesCsv(
  pool: Pool,
  fromDate?: Date,
  toDate?: Date,
  status?: string
): AsyncGenerator<string> {
  const headers = [
    'id',
    'sender',
    'recipient',
    'agent',
    'amount',
    'fee',
    'currency',
    'status',
    'corridor',
    'created_at',
    'updated_at',
    'memo',
  ];
  
  yield headers.map(escapeCsvField).join(',') + '\n';

  const query = `
    SELECT id, sender, recipient, agent, amount, fee, currency, status, corridor, created_at, updated_at, memo
    FROM remittances
    WHERE 1=1
      ${fromDate ? 'AND created_at >= $1' : ''}
      ${toDate ? `AND created_at <= ${fromDate ? '$2' : '$1'}` : ''}
      ${status ? `AND status = ${toDate ? '$3' : fromDate ? '$2' : '$1'}` : ''}
    ORDER BY created_at ASC
  `;

  const params: (Date | string)[] = [];
  if (fromDate) params.push(fromDate);
  if (toDate) params.push(toDate);
  if (status) params.push(status);

  const client = await pool.connect();
  try {
    const query_text = `
      SELECT id, sender, recipient, agent, amount, fee, currency, status, corridor, created_at, updated_at, memo
      FROM remittances
      ${fromDate || toDate || status ? 'WHERE' : ''}
      ${fromDate ? 'created_at >= $1' : ''}
      ${toDate ? (fromDate ? 'AND' : '') + ' created_at <= $' + (params.length + 1) : ''}
      ${status ? (fromDate || toDate ? 'AND' : '') + ' status = $' + (params.length + 1) : ''}
      ORDER BY created_at ASC
    `;

    const stream = client.query(query_text, params);
    
    for await (const row of stream) {
      const csvRow = [
        row.id,
        row.sender,
        row.recipient,
        row.agent,
        row.amount,
        row.fee,
        row.currency,
        row.status,
        row.corridor,
        row.created_at,
        row.updated_at,
        row.memo || '',
      ];
      yield csvRow.map(escapeCsvField).join(',') + '\n';
    }
  } finally {
    client.release();
  }
}

export function createAdminRouter(): Router {
  const router = Router();

  /**
   * @openapi
   * /api/admin/remittances/export:
   *   get:
   *     summary: Export remittances to CSV (admin only)
   *     description: >
   *       Stream remittance records as CSV for compliance reporting.
   *       Supports filtering by date range and status. Uses cursor streaming to avoid OOM.
   *       Requires admin authentication via x-api-key header.
   *     tags:
   *       - Admin
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - name: from
   *         in: query
   *         required: false
   *         description: Start date (ISO 8601)
   *         schema:
   *           type: string
   *       - name: to
   *         in: query
   *         required: false
   *         description: End date (ISO 8601)
   *         schema:
   *           type: string
   *       - name: status
   *         in: query
   *         required: false
   *         description: Filter by status
   *         schema:
   *           type: string
   *           enum: [Pending, Processing, Completed, Cancelled, Failed, Disputed]
   *     responses:
   *       200:
   *         description: CSV stream
   *         content:
   *           text/csv:
   *             schema:
   *               type: string
   *       401:
   *         description: Unauthorized
   */
  router.get('/remittances/export', async (req: Request, res: Response) => {
    if (!isAdminAuthorized(req)) {
      return sendError(res, 401, 'Admin authentication required', 'UNAUTHORIZED');
    }

    const { from, to, status } = req.query as Record<string, string | undefined>;
    
    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (from) {
      fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) {
        return sendError(res, 400, 'Invalid from date format', 'INVALID_FROM_DATE');
      }
    }

    if (to) {
      toDate = new Date(to);
      if (isNaN(toDate.getTime())) {
        return sendError(res, 400, 'Invalid to date format', 'INVALID_TO_DATE');
      }
    }

    if (status && !['Pending', 'Processing', 'Completed', 'Cancelled', 'Failed', 'Disputed'].includes(status)) {
      return sendError(res, 400, 'Invalid status', 'INVALID_STATUS');
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      return sendError(res, 503, 'Database not configured', 'DB_UNAVAILABLE');
    }

    const pool = new Pool({ connectionString: dbUrl });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="remittances-${new Date().toISOString()}.csv"`);

    try {
      const generator = streamRemittancesCsv(pool, fromDate, toDate, status);
      for await (const chunk of generator) {
        res.write(chunk);
      }
    } finally {
      res.end();
      await pool.end();
    }
  });

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
   *     summary: Simulate a contract upgrade (strictly read-only, requires admin auth + confirmation token)
   *     description: >
   *       Returns a structured preview of the storage migrations, resource usage,
   *       and warnings that would arise if the supplied WASM hash were used in a
   *       real upgrade proposal.  No on-chain state, no database state, and no
   *       transaction is ever modified or submitted.  Requires both an admin API
   *       key (x-api-key) and a valid second-admin confirmation token.
   *       Rate-limited to 5 requests per 15 minutes per IP.
   *       Every invocation — including failures — is audit-logged.
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
   *             additionalProperties: false
   *             properties:
   *               wasm_hash:
   *                 type: string
   *                 description: 64-character hex-encoded SHA-256 hash of the WASM blob (32 bytes)
   *                 pattern: '^[0-9a-fA-F]{64}$'
   *                 example: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
   *               confirmation_token:
   *                 type: string
   *                 description: UUID confirmation token issued by a second admin via POST /api/admin/actions
   *     responses:
   *       200:
   *         description: Read-only simulation report
   *         headers:
   *           X-Simulation-Only:
   *             schema:
   *               type: string
   *               example: "true"
   *             description: Always "true" — confirms no state was mutated
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SimulateUpgradeResponse'
   *       400:
   *         description: Invalid wasm_hash, disallowed hash, extra fields, or oversized payload
   *       401:
   *         description: Admin key missing/invalid or confirmation token invalid/expired
   *       429:
   *         description: Rate limit exceeded (5 req / 15 min per IP)
   *       503:
   *         description: Database not configured
   */
  router.post(
    '/simulate-upgrade',
    simulateUpgradeRateLimiter,
    simulateUpgradeBodySizeGuard,
    async (req: Request, res: Response) => {
      // Derive an IP address and a non-secret key hint for audit records.
      const ipAddress =
        (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
        req.socket?.remoteAddress ??
        null;
      const rawKey = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : '';
      const keyHint = rawKey.length >= 4 ? `...${rawKey.slice(-4)}` : '[none]';

      // ── 1. Admin authentication (timing-safe) ──────────────────────────────
      if (!isAdminAuthorized(req)) {
        await auditSimulateUpgrade({
          admin_key_hint: keyHint,
          wasm_hash: null,
          ip_address: ipAddress,
          outcome: 'rejected',
          rejection_code: 'UNAUTHORIZED',
        });
        return sendError(res, 401, 'Admin authentication required', 'UNAUTHORIZED');
      }

      // ── 2. Reject unknown fields (no extra properties allowed) ─────────────
      const allowedFields = new Set(['wasm_hash', 'confirmation_token']);
      const extraFields = Object.keys(req.body ?? {}).filter((k) => !allowedFields.has(k));
      if (extraFields.length > 0) {
        await auditSimulateUpgrade({
          admin_key_hint: keyHint,
          wasm_hash: null,
          ip_address: ipAddress,
          outcome: 'rejected',
          rejection_code: 'EXTRA_FIELDS',
        });
        return sendError(
          res,
          400,
          `Unexpected field(s): ${extraFields.join(', ')}`,
          'EXTRA_FIELDS',
        );
      }

      const { wasm_hash, confirmation_token } = req.body as Record<string, unknown>;

      // ── 3. confirmation_token presence check ───────────────────────────────
      if (!confirmation_token || typeof confirmation_token !== 'string') {
        await auditSimulateUpgrade({
          admin_key_hint: keyHint,
          wasm_hash: null,
          ip_address: ipAddress,
          outcome: 'rejected',
          rejection_code: 'MISSING_CONFIRMATION_TOKEN',
        });
        return sendError(
          res,
          400,
          'confirmation_token is required for this high-risk operation',
          'MISSING_CONFIRMATION_TOKEN',
        );
      }

      // ── 4. WASM hash format validation ─────────────────────────────────────
      if (!isValidWasmHash(wasm_hash)) {
        await auditSimulateUpgrade({
          admin_key_hint: keyHint,
          wasm_hash: null,
          ip_address: ipAddress,
          outcome: 'rejected',
          rejection_code: 'INVALID_WASM_HASH',
        });
        return sendError(
          res,
          400,
          'wasm_hash must be a 64-character hex string (32 bytes)',
          'INVALID_WASM_HASH',
        );
      }

      // ── 5. WASM hash allowlist check (when configured) ─────────────────────
      const allowlist = getWasmHashAllowlist();
      if (allowlist !== null && !allowlist.has(wasm_hash.toLowerCase())) {
        await auditSimulateUpgrade({
          admin_key_hint: keyHint,
          wasm_hash,
          ip_address: ipAddress,
          outcome: 'rejected',
          rejection_code: 'WASM_HASH_NOT_ALLOWLISTED',
        });
        return sendError(
          res,
          400,
          'wasm_hash is not in the permitted allowlist',
          'WASM_HASH_NOT_ALLOWLISTED',
        );
      }

      // ── 6. Confirmation token verification ─────────────────────────────────
      const svc = getConfirmationService();
      if (!svc) {
        await auditSimulateUpgrade({
          admin_key_hint: keyHint,
          wasm_hash,
          ip_address: ipAddress,
          outcome: 'rejected',
          rejection_code: 'DB_UNAVAILABLE',
        });
        return sendError(res, 503, 'Database not configured', 'DB_UNAVAILABLE');
      }

      const tokenHint =
        confirmation_token.length >= 4
          ? `...${confirmation_token.slice(-4)}`
          : '[short]';

      try {
        await svc.initTable();
        const action = await svc.verify(confirmation_token);

        if (!action) {
          await auditSimulateUpgrade({
            admin_key_hint: keyHint,
            wasm_hash,
            ip_address: ipAddress,
            outcome: 'rejected',
            rejection_code: 'INVALID_CONFIRMATION_TOKEN',
            confirmation_token_hint: tokenHint,
          });
          return sendError(
            res,
            401,
            'Invalid or expired confirmation token',
            'INVALID_CONFIRMATION_TOKEN',
          );
        }

        // ── 7. Run simulation (read-only — no DB writes, no transactions) ───
        const report = simulateUpgrade(wasm_hash);

        // Audit success BEFORE sending the response so the log entry is
        // guaranteed even if the connection drops.
        await auditSimulateUpgrade({
          admin_key_hint: keyHint,
          wasm_hash,
          ip_address: ipAddress,
          outcome: 'success',
          confirmation_token_hint: tokenHint,
        });

        // X-Simulation-Only confirms to any intermediary (proxy, WAF, SIEM)
        // that this response is the result of a read-only operation.
        res.setHeader('X-Simulation-Only', 'true');
        res.setHeader('Cache-Control', 'no-store');

        return res.json({
          success: true,
          data: report,
          timestamp: timestamp(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Confirmation verification failed';
        await auditSimulateUpgrade({
          admin_key_hint: keyHint,
          wasm_hash,
          ip_address: ipAddress,
          outcome: 'rejected',
          rejection_code: 'CONFIRMATION_VERIFICATION_FAILED',
          confirmation_token_hint: tokenHint,
        });
        return sendError(res, 401, msg, 'CONFIRMATION_VERIFICATION_FAILED');
      }
    },
  );

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
