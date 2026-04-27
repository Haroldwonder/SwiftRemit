import { Router, Request, Response } from 'express';
import { ErrorResponse } from '../types';

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

export function createAdminRouter(): Router {
  const router = Router();

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

  return router;
}
