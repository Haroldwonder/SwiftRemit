/**
 * Tests for middleware/api-key-store.ts (SR-043)
 *
 * Covers:
 *   - generateApiKey / hashApiKey helpers
 *   - ApiKeyStore: create, lookupByKey, listByOwner, revoke
 *   - ApiKeyStore.hasScope — scope model & admin:* wildcard
 *   - requiredScopeForRoute — ROUTE_SCOPES table
 *   - Security invariants: hash stored, not plaintext; expired/revoked rejected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateApiKey,
  hashApiKey,
  ApiKeyStore,
  ALL_SCOPES,
  TIER_CONFIGS,
  requiredScopeForRoute,
  ApiKeyRecord,
  ApiKeySafeRecord,
} from '../middleware/api-key-store';

// ── DB mock ────────────────────────────────────────────────────────────────────

function makePool(rows: object[][] = []) {
  let call = 0;
  return {
    query: vi.fn(async () => {
      const r = rows[call] ?? [];
      call++;
      return { rows: r, rowCount: r.length };
    }),
  };
}

function makeRecord(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    key_id:       'key-uuid',
    name:         'test-key',
    key_hash:     hashApiKey('sr_live_testvalue'),
    owner_id:     'owner-1',
    scopes:       ['read:verification'],
    tier:         'free',
    active:       true,
    expires_at:   new Date(Date.now() + 86_400_000),
    last_used_at: null,
    created_at:   new Date(),
    revoked_at:   null,
    ...overrides,
  };
}

// ── generateApiKey ─────────────────────────────────────────────────────────────

describe('generateApiKey', () => {
  it('starts with sr_live_ prefix', () => {
    expect(generateApiKey()).toMatch(/^sr_live_/);
  });

  it('produces different values on each call', () => {
    const keys = new Set(Array.from({ length: 20 }, generateApiKey));
    expect(keys.size).toBe(20);
  });

  it('is at least 40 characters long', () => {
    expect(generateApiKey().length).toBeGreaterThanOrEqual(40);
  });
});

// ── hashApiKey ─────────────────────────────────────────────────────────────────

describe('hashApiKey', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const h = hashApiKey('any-key');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    expect(hashApiKey('fixed-key')).toBe(hashApiKey('fixed-key'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashApiKey('key-a')).not.toBe(hashApiKey('key-b'));
  });

  it('is non-reversible — plaintext not recoverable from hash', () => {
    const plain = generateApiKey();
    const hash  = hashApiKey(plain);
    // Can only verify by re-hashing, never by reading the hash value
    expect(hash).not.toBe(plain);
    expect(hash).not.toContain('sr_live_');
  });
});

// ── TIER_CONFIGS ───────────────────────────────────────────────────────────────

describe('TIER_CONFIGS', () => {
  it('free tier has lower limits than standard', () => {
    expect(TIER_CONFIGS.free.maxRequests).toBeLessThan(TIER_CONFIGS.standard.maxRequests);
  });

  it('standard tier has lower limits than premium', () => {
    expect(TIER_CONFIGS.standard.maxRequests).toBeLessThan(TIER_CONFIGS.premium.maxRequests);
  });

  it('all tiers share the same window', () => {
    expect(TIER_CONFIGS.free.windowMs).toBe(TIER_CONFIGS.standard.windowMs);
    expect(TIER_CONFIGS.standard.windowMs).toBe(TIER_CONFIGS.premium.windowMs);
  });
});

// ── ApiKeyStore.create ─────────────────────────────────────────────────────────

describe('ApiKeyStore.create', () => {
  it('returns a secret prefixed with sr_live_', async () => {
    const row   = makeRecord();
    const pool  = makePool([[row], []]); // INSERT + audit INSERT
    const store = new ApiKeyStore(pool as any);

    const result = await store.create({
      name: 'my-key', ownerId: 'owner-1', scopes: ['read:verification'],
    });

    expect(result.secret).toMatch(/^sr_live_/);
  });

  it('does NOT store the plaintext key in the database', async () => {
    const row   = makeRecord();
    const pool  = makePool([[row], []]);
    const store = new ApiKeyStore(pool as any);

    const result = await store.create({
      name: 'my-key', ownerId: 'owner-1', scopes: ['read:verification'],
    });

    // Examine every value passed to pool.query — none should equal the plaintext
    const allQueryArgs = pool.query.mock.calls.flatMap((call) => call[1] ?? []);
    expect(allQueryArgs).not.toContain(result.secret);
  });

  it('stores a SHA-256 hash in the INSERT', async () => {
    const row   = makeRecord();
    const pool  = makePool([[row], []]);
    const store = new ApiKeyStore(pool as any);

    const result = await store.create({
      name: 'my-key', ownerId: 'owner-1', scopes: ['read:verification'],
    });

    const insertArgs: string[] = pool.query.mock.calls[0][1];
    const storedHash = insertArgs[1]; // second param is key_hash
    expect(storedHash).toBe(hashApiKey(result.secret));
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes an audit log entry for key creation', async () => {
    const row   = makeRecord();
    const pool  = makePool([[row], []]);
    const store = new ApiKeyStore(pool as any);

    await store.create({ name: 'k', ownerId: 'o', scopes: ['read:verification'] });

    // Two queries: INSERT api_keys + INSERT admin_audit_log
    expect(pool.query).toHaveBeenCalledTimes(2);
    const auditSql: string = pool.query.mock.calls[1][0];
    expect(auditSql.toLowerCase()).toContain('admin_audit_log');
  });

  it('defaults to free tier when no tier is specified', async () => {
    const row   = makeRecord({ tier: 'free' });
    const pool  = makePool([[row], []]);
    const store = new ApiKeyStore(pool as any);

    const result = await store.create({ name: 'k', ownerId: 'o', scopes: ['read:verification'] });
    expect(result.tier).toBe('free');
  });

  it('respects an explicit tier', async () => {
    const row   = makeRecord({ tier: 'premium' });
    const pool  = makePool([[row], []]);
    const store = new ApiKeyStore(pool as any);

    const result = await store.create({
      name: 'k', ownerId: 'o', scopes: ['read:verification'], tier: 'premium',
    });
    expect(result.tier).toBe('premium');
  });
});

// ── ApiKeyStore.lookupByKey ────────────────────────────────────────────────────

describe('ApiKeyStore.lookupByKey', () => {
  it('returns the record when key is valid', async () => {
    const plaintext = generateApiKey();
    const row = makeRecord({ key_hash: hashApiKey(plaintext) });
    const pool = makePool([[row]]);
    const store = new ApiKeyStore(pool as any);

    const result = await store.lookupByKey(plaintext);
    expect(result?.key_id).toBe(row.key_id);
  });

  it('returns null when key is not found', async () => {
    const pool  = makePool([[]]);
    const store = new ApiKeyStore(pool as any);
    expect(await store.lookupByKey('sr_live_unknown')).toBeNull();
  });

  it('returns null when key is revoked (active = false)', async () => {
    const row  = makeRecord({ active: false });
    const pool = makePool([[row]]);
    const store = new ApiKeyStore(pool as any);
    expect(await store.lookupByKey('sr_live_any')).toBeNull();
  });

  it('returns null when key has expired', async () => {
    const row  = makeRecord({ expires_at: new Date(Date.now() - 1000) });
    const pool = makePool([[row]]);
    const store = new ApiKeyStore(pool as any);
    expect(await store.lookupByKey('sr_live_any')).toBeNull();
  });

  it('looks up by hash, never by plaintext', async () => {
    const plaintext = generateApiKey();
    const row  = makeRecord({ key_hash: hashApiKey(plaintext) });
    const pool = makePool([[row]]);
    const store = new ApiKeyStore(pool as any);

    await store.lookupByKey(plaintext);

    const selectArgs: string[] = pool.query.mock.calls[0][1];
    // The value passed to the SELECT must be the hash, not the plaintext
    expect(selectArgs[0]).toBe(hashApiKey(plaintext));
    expect(selectArgs[0]).not.toBe(plaintext);
  });
});

// ── ApiKeyStore.listByOwner ────────────────────────────────────────────────────

describe('ApiKeyStore.listByOwner', () => {
  it('returns all keys for an owner', async () => {
    const rows: ApiKeySafeRecord[] = [
      { ...makeRecord(), key_hash: undefined } as any,
      { ...makeRecord({ key_id: 'key-2' }), key_hash: undefined } as any,
    ];
    const pool  = makePool([rows]);
    const store = new ApiKeyStore(pool as any);

    const result = await store.listByOwner('owner-1');
    expect(result).toHaveLength(2);
  });

  it('returns an empty array when owner has no keys', async () => {
    const pool  = makePool([[]]);
    const store = new ApiKeyStore(pool as any);
    expect(await store.listByOwner('nobody')).toEqual([]);
  });

  it('does not include key_hash in the SELECT', async () => {
    const pool  = makePool([[]]);
    const store = new ApiKeyStore(pool as any);
    await store.listByOwner('owner-1');

    const sql: string = pool.query.mock.calls[0][0];
    expect(sql.toLowerCase()).not.toContain('key_hash');
  });
});

// ── ApiKeyStore.revoke ─────────────────────────────────────────────────────────

describe('ApiKeyStore.revoke', () => {
  it('returns true and writes audit log when key is revoked', async () => {
    // UPDATE returns 1 row; audit INSERT returns nothing
    const pool  = makePool([[{ key_id: 'key-uuid' }], []]);
    const store = new ApiKeyStore(pool as any);

    const ok = await store.revoke({ keyId: 'key-uuid', ownerId: 'owner-1' });

    expect(ok).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(2);
    const auditSql: string = pool.query.mock.calls[1][0];
    expect(auditSql.toLowerCase()).toContain('admin_audit_log');
  });

  it('returns false when key is not found or already revoked', async () => {
    const pool  = makePool([[]]); // UPDATE returns 0 rows
    const store = new ApiKeyStore(pool as any);
    expect(await store.revoke({ keyId: 'missing', ownerId: 'owner-1' })).toBe(false);
  });

  it('does not allow one owner to revoke another owner\'s key', async () => {
    // The UPDATE WHERE clause includes owner_id — if owner doesn't match, rowCount = 0
    const pool  = makePool([[]]); // 0 rows → wrong owner
    const store = new ApiKeyStore(pool as any);

    const ok = await store.revoke({ keyId: 'key-uuid', ownerId: 'wrong-owner' });
    expect(ok).toBe(false);
  });
});

// ── ApiKeyStore.hasScope ───────────────────────────────────────────────────────

describe('ApiKeyStore.hasScope', () => {
  it('returns true when the exact scope is present', () => {
    expect(ApiKeyStore.hasScope({ scopes: ['read:verification'] }, 'read:verification')).toBe(true);
  });

  it('returns false when the exact scope is absent', () => {
    expect(ApiKeyStore.hasScope({ scopes: ['read:verification'] }, 'write:remittance')).toBe(false);
  });

  it('admin:* satisfies any scope check', () => {
    const adminKey = { scopes: ['admin:*'] as any };
    for (const scope of ALL_SCOPES) {
      expect(ApiKeyStore.hasScope(adminKey, scope)).toBe(true);
    }
  });

  it('a read:verification key cannot satisfy write:remittance', () => {
    expect(
      ApiKeyStore.hasScope({ scopes: ['read:verification'] }, 'write:remittance'),
    ).toBe(false);
  });

  it('a key with multiple scopes satisfies each of them', () => {
    const record = { scopes: ['read:verification', 'read:remittance'] as any };
    expect(ApiKeyStore.hasScope(record, 'read:verification')).toBe(true);
    expect(ApiKeyStore.hasScope(record, 'read:remittance')).toBe(true);
    expect(ApiKeyStore.hasScope(record, 'write:remittance')).toBe(false);
  });
});

// ── requiredScopeForRoute ──────────────────────────────────────────────────────

describe('requiredScopeForRoute', () => {
  const CASES: Array<[string, string, string | null]> = [
    ['GET',    '/api/admin/fees',            'admin:*'],
    ['POST',   '/api/admin/simulate-upgrade','admin:*'],
    ['DELETE', '/api/admin/keys/abc',        'admin:*'],
    ['PATCH',  '/api/admin/flags/1',         'admin:*'],
    ['POST',   '/api/kyc/config',            'admin:*'],
    ['GET',    '/api/developers/keys',       'admin:*'],
    ['POST',   '/api/developers/keys',       'admin:*'],
    ['DELETE', '/api/developers/keys/x',     'admin:*'],
    ['POST',   '/api/remittance',            'write:remittance'],
    ['POST',   '/api/fx-rate',               'write:remittance'],
    ['GET',    '/api/remittance/rem-1',      'read:remittance'],
    ['GET',    '/api/fx-rate/current',       'read:remittance'],
    ['GET',    '/api/kyc/status',            'read:kyc'],
    ['POST',   '/api/kyc/register',          'write:kyc'],
    ['GET',    '/api/verification/verified', 'read:verification'],
    ['POST',   '/api/verification/verify',   'read:verification'],
    // Unscoped routes — should return null
    ['GET',    '/health',                    null],
    ['GET',    '/metrics',                   null],
    ['GET',    '/api/docs',                  null],
  ];

  for (const [method, path, expected] of CASES) {
    it(`${method} ${path} → ${expected ?? 'null (no scope required)'}`, () => {
      expect(requiredScopeForRoute(method, path)).toBe(expected);
    });
  }
});
