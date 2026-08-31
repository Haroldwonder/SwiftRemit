/**
 * API Key Store (SR-043)
 *
 * Implements scoped API keys with:
 *   - SHA-256 hashed storage (plaintext never persisted after creation)
 *   - Scope model enforced at middleware layer
 *   - Key expiry (configurable TTL, default 1 year)
 *   - Revocation with immediate effect
 *   - last_used_at tracking (updated at most once per minute to reduce write load)
 *   - Per-tier rate-limit configuration returned with each lookup
 *   - Every create / revoke action written to admin_audit_log
 *
 * ── Scope model ──────────────────────────────────────────────────────────────
 *
 *   read:verification   GET /api/verification/*
 *   write:remittance    POST /api/remittance, POST /api/fx-rate
 *   read:remittance     GET  /api/remittance/*, GET /api/fx-rate/*
 *   read:kyc            GET  /api/kyc/*
 *   admin:*             All /api/admin/* routes + /api/kyc/config
 *
 * Scopes follow the convention `<action>:<resource>` where action is one of
 * `read`, `write`, or `admin`, and resource is the top-level domain noun.
 * `admin:*` is a wildcard that satisfies any `admin:` scope check.
 *
 * ── Rate-limit tiers ─────────────────────────────────────────────────────────
 *
 *   free      100 req / min   (default for new keys)
 *   standard  500 req / min
 *   premium  2000 req / min
 */

import crypto from 'crypto';
import { Pool } from 'pg';
import { AdminAuditLogService } from '../admin-audit-log';

// ── Scope definitions ─────────────────────────────────────────────────────────

export const ALL_SCOPES = [
  'read:verification',
  'write:remittance',
  'read:remittance',
  'read:kyc',
  'write:kyc',
  'admin:*',
  'read:compliance',
  'read:devices',
] as const;

export type ApiKeyScope = (typeof ALL_SCOPES)[number];

export type RateLimitTier = 'free' | 'standard' | 'premium';

export interface TierConfig {
  maxRequests: number;
  windowMs: number;
}

export const TIER_CONFIGS: Record<RateLimitTier, TierConfig> = {
  free:     { maxRequests: 100,  windowMs: 60_000 },
  standard: { maxRequests: 500,  windowMs: 60_000 },
  premium:  { maxRequests: 2000, windowMs: 60_000 },
};

// ── Key record types ──────────────────────────────────────────────────────────

export interface ApiKeyRecord {
  key_id:       string;
  name:         string;
  key_hash:     string;         // SHA-256 hex — never the plaintext key
  owner_id:     string;
  scopes:       ApiKeyScope[];
  tier:         RateLimitTier;
  active:       boolean;
  expires_at:   Date | null;
  last_used_at: Date | null;
  created_at:   Date;
  revoked_at:   Date | null;
}

/** Returned only at creation — full secret shown exactly once */
export interface ApiKeyCreateResult {
  key_id:     string;
  name:       string;
  secret:     string;           // plaintext — shown once, not stored
  scopes:     ApiKeyScope[];
  tier:       RateLimitTier;
  expires_at: Date | null;
  created_at: Date;
}

/** Safe representation for list / GET responses — no hash, no secret */
export interface ApiKeySafeRecord {
  key_id:       string;
  name:         string;
  owner_id:     string;
  scopes:       ApiKeyScope[];
  tier:         RateLimitTier;
  active:       boolean;
  expires_at:   Date | null;
  last_used_at: Date | null;
  created_at:   Date;
}

// ── Hashing helpers ───────────────────────────────────────────────────────────

/** Prefix added to every generated key for easy identification in logs. */
const KEY_PREFIX = 'sr_live_';

/** Generate a cryptographically random API key. */
export function generateApiKey(): string {
  return KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
}

/** SHA-256 hex hash of a key value (used for storage and lookup). */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ── Last-used throttle ────────────────────────────────────────────────────────

/** Track when we last wrote last_used_at for each key_id (key → epoch ms). */
const lastUsedWritten = new Map<string, number>();
const LAST_USED_WRITE_INTERVAL_MS = 60_000; // max once per minute

// ── ApiKeyStore ───────────────────────────────────────────────────────────────

export class ApiKeyStore {
  private audit: AdminAuditLogService;

  constructor(private readonly pool: Pool) {
    this.audit = new AdminAuditLogService(pool);
  }

  // ── DDL ───────────────────────────────────────────────────────────────────

  async initTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        key_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        name         VARCHAR(128) NOT NULL,
        key_hash     CHAR(64)     NOT NULL UNIQUE,  -- SHA-256 hex, never plaintext
        owner_id     VARCHAR(256) NOT NULL,
        scopes       TEXT[]       NOT NULL DEFAULT '{}',
        tier         VARCHAR(16)  NOT NULL DEFAULT 'free',
        active       BOOLEAN      NOT NULL DEFAULT TRUE,
        expires_at   TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        revoked_at   TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash    ON api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_api_keys_owner   ON api_keys(owner_id);
      CREATE INDEX IF NOT EXISTS idx_api_keys_active  ON api_keys(active);
    `);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(opts: {
    name:       string;
    ownerId:    string;
    scopes:     ApiKeyScope[];
    tier?:      RateLimitTier;
    expiresAt?: Date | null;
    ipAddress?: string;
  }): Promise<ApiKeyCreateResult> {
    const plaintext = generateApiKey();
    const keyHash   = hashApiKey(plaintext);
    const tier      = opts.tier ?? 'free';
    const expiresAt = opts.expiresAt ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const result = await this.pool.query<ApiKeyRecord>(
      `INSERT INTO api_keys (name, key_hash, owner_id, scopes, tier, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [opts.name, keyHash, opts.ownerId, opts.scopes, tier, expiresAt],
    );

    const row = result.rows[0];

    await this.audit.log({
      admin_address: opts.ownerId,
      action:        'api_key.created',
      target:        row.key_id,
      params_json:   { name: opts.name, scopes: opts.scopes, tier, expires_at: expiresAt },
      tx_hash:       null,
      ip_address:    opts.ipAddress ?? null,
    });

    return {
      key_id:     row.key_id,
      name:       row.name,
      secret:     plaintext,   // returned ONCE — not stored anywhere
      scopes:     row.scopes,
      tier:       row.tier,
      expires_at: row.expires_at,
      created_at: row.created_at,
    };
  }

  // ── Lookup by plaintext key ────────────────────────────────────────────────

  /**
   * Resolve a plaintext key to its record.
   * Returns null when the key is unknown, revoked, or expired.
   * Updates last_used_at at most once per LAST_USED_WRITE_INTERVAL_MS.
   */
  async lookupByKey(plaintext: string): Promise<ApiKeyRecord | null> {
    const hash = hashApiKey(plaintext);
    const result = await this.pool.query<ApiKeyRecord>(
      `SELECT * FROM api_keys WHERE key_hash = $1`,
      [hash],
    );

    const row = result.rows[0];
    if (!row) return null;
    if (!row.active) return null;
    if (row.expires_at && row.expires_at <= new Date()) return null;

    // Throttled last_used_at write
    const now = Date.now();
    const lastWrite = lastUsedWritten.get(row.key_id) ?? 0;
    if (now - lastWrite > LAST_USED_WRITE_INTERVAL_MS) {
      lastUsedWritten.set(row.key_id, now);
      // Fire-and-forget — don't block the request
      this.pool.query(
        `UPDATE api_keys SET last_used_at = NOW() WHERE key_id = $1`,
        [row.key_id],
      ).catch(() => { /* non-critical */ });
    }

    return row;
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async listByOwner(ownerId: string): Promise<ApiKeySafeRecord[]> {
    const result = await this.pool.query<ApiKeySafeRecord>(
      `SELECT key_id, name, owner_id, scopes, tier, active, expires_at, last_used_at, created_at
       FROM api_keys
       WHERE owner_id = $1
       ORDER BY created_at DESC`,
      [ownerId],
    );
    return result.rows;
  }

  // ── Revoke ────────────────────────────────────────────────────────────────

  async revoke(opts: {
    keyId:     string;
    ownerId:   string;
    ipAddress?: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE api_keys
       SET active = FALSE, revoked_at = NOW()
       WHERE key_id = $1 AND owner_id = $2 AND active = TRUE
       RETURNING key_id`,
      [opts.keyId, opts.ownerId],
    );

    if ((result.rowCount ?? 0) === 0) return false;

    await this.audit.log({
      admin_address: opts.ownerId,
      action:        'api_key.revoked',
      target:        opts.keyId,
      params_json:   null,
      tx_hash:       null,
      ip_address:    opts.ipAddress ?? null,
    });

    return true;
  }

  // ── Scope helpers ─────────────────────────────────────────────────────────

  /**
   * Returns true when `record.scopes` satisfies `required`.
   * `admin:*` satisfies any `admin:` prefixed scope, and also acts as a
   * superscope that satisfies every read/write scope.
   */
  static hasScope(record: Pick<ApiKeyRecord, 'scopes'>, required: ApiKeyScope): boolean {
    if (record.scopes.includes('admin:*')) return true;
    if (record.scopes.includes(required)) return true;
    // admin:* also covers wildcard-style: admin:users, admin:fees, etc.
    if (required.startsWith('admin:') && record.scopes.includes('admin:*')) return true;
    return false;
  }
}

// ── Route-scope mapping ───────────────────────────────────────────────────────

/**
 * Maps Express route patterns to the scope required to call them.
 * Evaluated in order; first match wins.
 *
 * Pattern syntax: `METHOD /path/prefix` where prefix is a substring match
 * against `req.method + ' ' + req.path`.
 */
export const ROUTE_SCOPES: Array<{ prefix: string; scope: ApiKeyScope }> = [
  // Admin routes
  { prefix: 'GET /api/admin',           scope: 'admin:*' },
  { prefix: 'POST /api/admin',          scope: 'admin:*' },
  { prefix: 'DELETE /api/admin',        scope: 'admin:*' },
  { prefix: 'PATCH /api/admin',         scope: 'admin:*' },
  { prefix: 'POST /api/kyc/config',     scope: 'admin:*' },
  { prefix: 'GET /api/developers',      scope: 'admin:*' },
  { prefix: 'POST /api/developers',     scope: 'admin:*' },
  { prefix: 'DELETE /api/developers',   scope: 'admin:*' },
  // Remittance writes
  { prefix: 'POST /api/remittance',     scope: 'write:remittance' },
  { prefix: 'POST /api/fx-rate',        scope: 'write:remittance' },
  // Remittance reads
  { prefix: 'GET /api/remittance',      scope: 'read:remittance' },
  { prefix: 'GET /api/fx-rate',         scope: 'read:remittance' },
  // KYC reads
  { prefix: 'GET /api/kyc',             scope: 'read:kyc' },
  { prefix: 'POST /api/kyc/register',   scope: 'write:kyc' },
  // AML/CTF operations (SR-112 surface) — officer-attributed mutations still
  // require admin:*; read-only queue/status views accept the narrower
  // read:compliance scope (satisfied automatically by admin:* too).
  { prefix: 'PATCH /api/aml',           scope: 'admin:*' },
  { prefix: 'POST /api/aml',            scope: 'admin:*' },
  { prefix: 'GET /api/aml',             scope: 'read:compliance' },
  // Compliance reporting — flagged remittances, thresholds, manual flags.
  { prefix: 'POST /api/compliance',     scope: 'admin:*' },
  { prefix: 'PATCH /api/compliance',    scope: 'admin:*' },
  { prefix: 'GET /api/compliance',      scope: 'read:compliance' },
  // Registered device management.
  { prefix: 'POST /api/devices',        scope: 'admin:*' },
  { prefix: 'PATCH /api/devices',       scope: 'admin:*' },
  { prefix: 'DELETE /api/devices',      scope: 'admin:*' },
  { prefix: 'GET /api/devices',         scope: 'read:devices' },
  // Verification reads (most permissive — default for free-tier keys)
  { prefix: 'GET /api/verification',    scope: 'read:verification' },
  { prefix: 'POST /api/verification',   scope: 'read:verification' },
];

/**
 * Determine which scope is required for the given method + path.
 * Returns null for routes that do not require a scope check (health, docs, metrics).
 */
export function requiredScopeForRoute(method: string, path: string): ApiKeyScope | null {
  const key = `${method.toUpperCase()} ${path}`;
  for (const { prefix, scope } of ROUTE_SCOPES) {
    if (key.startsWith(prefix)) return scope;
  }
  return null;
}
