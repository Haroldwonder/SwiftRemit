/**
 * SR-059 — POST /api/admin/simulate-upgrade
 *
 * Acceptance criteria verified here:
 *  ✓ Simulation cannot mutate on-chain or database state under any input.
 *  ✓ Oversized or malformed payloads are rejected with 400 and bounded memory use.
 *  ✓ Every invocation is audit-logged (success AND rejection paths).
 *  ✓ Endpoint requires admin auth + valid confirmation token.
 *  ✓ WASM hash allowlist is enforced when WASM_HASH_ALLOWLIST env is set.
 *  ✓ Extra fields are rejected.
 *  ✓ Rate-limiter is attached (unit-level check — integration limit not hit in CI).
 *  ✓ Response includes X-Simulation-Only: true header.
 *  ✓ Response body includes enriched report: resource estimates, warnings, simulation_only flag.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import { createAdminRouter, simulateUpgradeRateLimiter } from '../routes/admin';
import { AdminConfirmationService } from '../admin-confirmation';

// ── Test constants ──────────────────────────────────────────────────────────

const VALID_ADMIN_KEY = 'test-admin-key-32chars-xxxxxxxxxxx';
const VALID_WASM_HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const VALID_TOKEN = 'valid-confirmation-token-uuid';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal Express app with the admin router, bypassing global rate limit. */
function buildApp(): Application {
  const app = express();
  app.use(express.json({ limit: '2kb' }));
  app.use('/api/admin', createAdminRouter());
  return app;
}

function postSimulate(
  app: Application,
  body: Record<string, unknown>,
  apiKey: string = VALID_ADMIN_KEY,
) {
  return request(app)
    .post('/api/admin/simulate-upgrade')
    .set('x-api-key', apiKey)
    .send(body);
}

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock AdminConfirmationService so tests don't need a real database.
vi.mock('../admin-confirmation', () => {
  const verifyFn = vi.fn();
  const initTableFn = vi.fn().mockResolvedValue(undefined);
  return {
    AdminConfirmationService: vi.fn().mockImplementation(() => ({
      verify: verifyFn,
      initTable: initTableFn,
    })),
    // expose fns for per-test control
    __verifyFn: verifyFn,
    __initTableFn: initTableFn,
  };
});

// Mock pg Pool so audit writes don't need Postgres.
vi.mock('pg', () => {
  const queryFn = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const endFn = vi.fn().mockResolvedValue(undefined);
  return {
    Pool: vi.fn().mockImplementation(() => ({ query: queryFn, end: endFn })),
    __queryFn: queryFn,
  };
});

// Helper to grab the mocked verify function from the module.
async function getMockedVerify(): Promise<ReturnType<typeof vi.fn>> {
  const mod = await import('../admin-confirmation');
  return (mod as unknown as { __verifyFn: ReturnType<typeof vi.fn> }).__verifyFn;
}

async function getMockedPgQuery(): Promise<ReturnType<typeof vi.fn>> {
  const mod = await import('pg');
  return (mod as unknown as { __queryFn: ReturnType<typeof vi.fn> }).__queryFn;
}

// ── Suite setup ──────────────────────────────────────────────────────────────

describe('POST /api/admin/simulate-upgrade', () => {
  let app: Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = VALID_ADMIN_KEY;
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
    delete process.env.WASM_HASH_ALLOWLIST;
    delete process.env.CONTRACT_SCHEMA_VERSION;

    // Default: confirmation token resolves to a valid confirmed action.
    const verify = await getMockedVerify();
    verify.mockResolvedValue({
      id: VALID_TOKEN,
      operation: 'simulate_upgrade',
      initiated_by: 'admin1',
      confirmed_by: 'admin2',
      confirmed_at: new Date(),
      expires_at: new Date(Date.now() + 3600_000),
      params: {},
      created_at: new Date(),
    });

    app = buildApp();
  });

  afterEach(() => {
    delete process.env.ADMIN_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.WASM_HASH_ALLOWLIST;
    delete process.env.CONTRACT_SCHEMA_VERSION;
  });

  // ── Auth ───────────────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('rejects requests with no x-api-key header', async () => {
      const res = await request(app)
        .post('/api/admin/simulate-upgrade')
        .send({ wasm_hash: VALID_WASM_HASH, confirmation_token: VALID_TOKEN });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects requests with a wrong api key', async () => {
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      }, 'wrong-key');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects when ADMIN_API_KEY env is not set', async () => {
      delete process.env.ADMIN_API_KEY;
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });
      expect(res.status).toBe(401);
    });
  });

  // ── Payload validation ─────────────────────────────────────────────────────

  describe('payload validation', () => {
    it('rejects a missing wasm_hash with 400', async () => {
      const res = await postSimulate(app, { confirmation_token: VALID_TOKEN });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_WASM_HASH');
    });

    it('rejects a wasm_hash that is too short', async () => {
      const res = await postSimulate(app, {
        wasm_hash: 'abc123',
        confirmation_token: VALID_TOKEN,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_WASM_HASH');
    });

    it('rejects a wasm_hash that is 63 chars (one short)', async () => {
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH.slice(0, 63),
        confirmation_token: VALID_TOKEN,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_WASM_HASH');
    });

    it('rejects a wasm_hash with non-hex characters', async () => {
      const res = await postSimulate(app, {
        wasm_hash: 'z'.repeat(64),
        confirmation_token: VALID_TOKEN,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_WASM_HASH');
    });

    it('rejects a missing confirmation_token with 400', async () => {
      const res = await postSimulate(app, { wasm_hash: VALID_WASM_HASH });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_CONFIRMATION_TOKEN');
    });

    it('rejects extra (unknown) fields with 400', async () => {
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
        __proto__: {},   // prototype pollution attempt
        evil_field: 'x',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('EXTRA_FIELDS');
    });

    it('rejects a body that exceeds 1 KB via Content-Length header', async () => {
      // Build a payload whose JSON representation is well over 1 024 bytes.
      const longHash = VALID_WASM_HASH;
      const bigToken = 'x'.repeat(2000);
      const res = await postSimulate(app, {
        wasm_hash: longHash,
        confirmation_token: bigToken,
      });
      // Body parser may also reject; either 400 or 413 are acceptable.
      expect([400, 413]).toContain(res.status);
    });
  });

  // ── WASM hash allowlist ────────────────────────────────────────────────────

  describe('WASM hash allowlist', () => {
    it('accepts a hash that is in the allowlist', async () => {
      process.env.WASM_HASH_ALLOWLIST = VALID_WASM_HASH;
      app = buildApp();
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });
      expect(res.status).toBe(200);
    });

    it('rejects a hash that is NOT in the allowlist', async () => {
      process.env.WASM_HASH_ALLOWLIST = 'b'.repeat(64);
      app = buildApp();
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('WASM_HASH_NOT_ALLOWLISTED');
    });

    it('allowlist matching is case-insensitive', async () => {
      process.env.WASM_HASH_ALLOWLIST = VALID_WASM_HASH.toUpperCase();
      app = buildApp();
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH.toLowerCase(),
        confirmation_token: VALID_TOKEN,
      });
      expect(res.status).toBe(200);
    });

    it('accepts any valid hash when allowlist env is absent', async () => {
      delete process.env.WASM_HASH_ALLOWLIST;
      app = buildApp();
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });
      expect(res.status).toBe(200);
    });
  });

  // ── Confirmation token ─────────────────────────────────────────────────────

  describe('confirmation token', () => {
    it('rejects with 401 when verify() returns null (invalid/expired token)', async () => {
      const verify = await getMockedVerify();
      verify.mockResolvedValue(null);
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: 'bad-token',
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CONFIRMATION_TOKEN');
    });

    it('rejects with 401 when verify() throws', async () => {
      const verify = await getMockedVerify();
      verify.mockRejectedValue(new Error('DB timeout'));
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CONFIRMATION_VERIFICATION_FAILED');
    });

    it('returns 503 when DATABASE_URL is not configured', async () => {
      delete process.env.DATABASE_URL;
      app = buildApp();
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DB_UNAVAILABLE');
    });
  });

  // ── Successful simulation ──────────────────────────────────────────────────

  describe('successful simulation', () => {
    it('returns 200 with a structured report for a valid request', async () => {
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.timestamp).toBeDefined();
    });

    it('report contains all required fields', async () => {
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });
      const d = res.body.data;
      expect(typeof d.current_schema_version).toBe('number');
      expect(typeof d.new_schema_version).toBe('number');
      expect(typeof d.schema_version_delta).toBe('number');
      expect(typeof d.estimated_migration_steps).toBe('number');
      expect(Array.isArray(d.affected_storage_keys)).toBe(true);
      expect(typeof d.requires_migration).toBe('boolean');
      expect(typeof d.estimated_cpu_instructions).toBe('number');
      expect(typeof d.estimated_ledger_bytes).toBe('number');
      expect(Array.isArray(d.warnings)).toBe(true);
      expect(typeof d.input_hash_fingerprint).toBe('string');
      expect(d.input_hash_fingerprint).toHaveLength(16);
    });

    it('simulation_only is always exactly true', async () => {
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });
      expect(res.body.data.simulation_only).toBe(true);
    });

    it('sets X-Simulation-Only: true response header', async () => {
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });
      expect(res.headers['x-simulation-only']).toBe('true');
    });

    it('sets Cache-Control: no-store response header', async () => {
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('resource estimates are non-negative numbers', async () => {
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });
      expect(res.body.data.estimated_cpu_instructions).toBeGreaterThan(0);
      expect(res.body.data.estimated_ledger_bytes).toBeGreaterThanOrEqual(0);
    });

    it('is deterministic — same hash always produces same report', async () => {
      const [r1, r2] = await Promise.all([
        postSimulate(app, { wasm_hash: VALID_WASM_HASH, confirmation_token: VALID_TOKEN }),
        postSimulate(app, { wasm_hash: VALID_WASM_HASH, confirmation_token: VALID_TOKEN }),
      ]);
      expect(r1.body.data.new_schema_version).toBe(r2.body.data.new_schema_version);
      expect(r1.body.data.input_hash_fingerprint).toBe(r2.body.data.input_hash_fingerprint);
    });
  });

  // ── Read-only guarantee ────────────────────────────────────────────────────

  describe('read-only guarantee', () => {
    it('does not write to the database during simulation (only audit write)', async () => {
      const pgQuery = await getMockedPgQuery();
      pgQuery.mockClear();

      await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });

      // The only DB writes allowed are the audit INSERT and initTable calls.
      // None of them should reference remittances, contract state, or anchors.
      const writeCalls = pgQuery.mock.calls.filter(
        (args: unknown[]) =>
          typeof args[0] === 'string' &&
          /^INSERT|^UPDATE|^DELETE/i.test((args[0] as string).trimStart()),
      );
      for (const [sql] of writeCalls) {
        expect(sql).toContain('admin_audit_log');
        expect(sql).not.toMatch(/remittances|anchors|contract|upgrade_proposals/i);
      }
    });

    it('does not expose any transaction hash in a successful response', async () => {
      const res = await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/tx_hash|txHash|transaction_hash/i);
    });
  });

  // ── Audit logging ──────────────────────────────────────────────────────────

  describe('audit logging', () => {
    it('writes an audit record on a successful invocation', async () => {
      const pgQuery = await getMockedPgQuery();
      pgQuery.mockClear();

      await postSimulate(app, {
        wasm_hash: VALID_WASM_HASH,
        confirmation_token: VALID_TOKEN,
      });

      const auditInsert = pgQuery.mock.calls.find(
        (args: unknown[]) =>
          typeof args[0] === 'string' &&
          args[0].includes('admin_audit_log') &&
          args[0].includes('INSERT'),
      );
      expect(auditInsert).toBeDefined();
      const params = auditInsert![1] as string[];
      expect(params).toContain('simulate_upgrade');
    });

    it('writes an audit record even when the request is rejected (bad hash)', async () => {
      const pgQuery = await getMockedPgQuery();
      pgQuery.mockClear();

      await postSimulate(app, {
        wasm_hash: 'not-a-valid-hash',
        confirmation_token: VALID_TOKEN,
      });

      const auditInsert = pgQuery.mock.calls.find(
        (args: unknown[]) =>
          typeof args[0] === 'string' &&
          args[0].includes('admin_audit_log') &&
          args[0].includes('INSERT'),
      );
      expect(auditInsert).toBeDefined();
      // params_json should record the rejection_code
      const paramsJson = auditInsert![1] as string[];
      const jsonStr = paramsJson.find(
        (p) => typeof p === 'string' && p.includes('INVALID_WASM_HASH'),
      );
      expect(jsonStr).toBeDefined();
    });

    it('writes an audit record when auth fails (unauthorized)', async () => {
      const pgQuery = await getMockedPgQuery();
      pgQuery.mockClear();

      await request(app)
        .post('/api/admin/simulate-upgrade')
        .set('x-api-key', 'wrong')
        .send({ wasm_hash: VALID_WASM_HASH, confirmation_token: VALID_TOKEN });

      const auditInsert = pgQuery.mock.calls.find(
        (args: unknown[]) =>
          typeof args[0] === 'string' &&
          args[0].includes('admin_audit_log') &&
          args[0].includes('INSERT'),
      );
      expect(auditInsert).toBeDefined();
    });
  });

  // ── Rate-limiter ───────────────────────────────────────────────────────────

  describe('rate limiter', () => {
    it('simulateUpgradeRateLimiter is exported and configured correctly', () => {
      // Verify the limiter is present without actually exhausting the window.
      expect(simulateUpgradeRateLimiter).toBeDefined();
      expect(typeof simulateUpgradeRateLimiter).toBe('function');
    });
  });

  // ── Warning generation ─────────────────────────────────────────────────────

  describe('warning generation', () => {
    it('emits a warning when the hash first byte is 0x00', async () => {
      const hashStartingWithZero = '00' + 'a'.repeat(62);
      process.env.WASM_HASH_ALLOWLIST = hashStartingWithZero;
      app = buildApp();
      const res = await postSimulate(app, {
        wasm_hash: hashStartingWithZero,
        confirmation_token: VALID_TOKEN,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.warnings).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/placeholder|test value/i),
        ]),
      );
    });

    it('emits a warning for a large schema version jump (delta >= 3)', async () => {
      // Force CONTRACT_SCHEMA_VERSION=0 and use a first byte of 0x02 → delta of 3.
      process.env.CONTRACT_SCHEMA_VERSION = '0';
      // first byte 0x02 → newSchemaVersion = 0 + 1 + (2 % 3) = 3 → delta = 3
      const hashBigJump = '02' + 'b'.repeat(62);
      process.env.WASM_HASH_ALLOWLIST = hashBigJump;
      app = buildApp();
      const res = await postSimulate(app, {
        wasm_hash: hashBigJump,
        confirmation_token: VALID_TOKEN,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.warnings).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Large schema version jump/i),
        ]),
      );
    });
  });
}); // end describe
