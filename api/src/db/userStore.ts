/**
 * Real user credential + role store, replacing the single shared
 * `STUB_PASSWORD` compared against every `userId` in `routes/auth.ts`.
 *
 * Previously "authentication" only proved the caller knew one process-wide
 * secret, not who they were — every login attempt for every userId was
 * checked against the same value. This module backs `verifyCredentials()`
 * with a real per-user password hash (bcrypt) and a real per-user role,
 * stored in Postgres when `DATABASE_URL` is configured (falling back to an
 * in-memory map otherwise, matching the pattern in `services/tokenStore.ts`
 * and `app.ts`'s optional pool for local dev / unit tests).
 *
 * `ADMIN_USER_IDS` / `AGENT_USER_IDS` are no longer read on every request.
 * They are read once, at first use, purely to seed the initial operator
 * accounts (`seedBootstrapOperators`) — a one-time bootstrap mechanism, not
 * the source of truth for authorization going forward. Once an identity
 * exists in this store its role lives here and can be changed without an
 * env var + redeploy.
 */

import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { getPool } from './pool.js';

export type UserRole = 'user' | 'agent' | 'admin';

export interface UserRecord {
  userId: string;
  passwordHash: string;
  role: UserRole;
}

const BCRYPT_COST_FACTOR = 12;

const FULL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(255) PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'user',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
`;

/** In-memory fallback used when no Postgres pool is configured (local dev, unit tests). */
const memoryUsers = new Map<string, UserRecord>();

let schemaReady: Promise<void> | null = null;
let bootstrapSeeded: Promise<void> | null = null;

function normalizeRole(value: unknown): UserRole {
  return value === 'admin' || value === 'agent' ? value : 'user';
}

async function ensureSchema(pool: Pool | null): Promise<void> {
  if (!pool) return;
  if (!schemaReady) {
    schemaReady = pool.query(FULL_SCHEMA_SQL).then(() => undefined);
  }
  await schemaReady;
}

async function findUser(pool: Pool | null, userId: string): Promise<UserRecord | null> {
  if (!pool) {
    return memoryUsers.get(userId) ?? null;
  }

  const result = await pool.query<{ user_id: string; password_hash: string; role: string }>(
    'SELECT user_id, password_hash, role FROM users WHERE user_id = $1',
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return { userId: row.user_id, passwordHash: row.password_hash, role: normalizeRole(row.role) };
}

/**
 * Creates or overwrites a user's credentials. Exposed for a future
 * self-service registration / admin-management endpoint; the login route
 * only ever reads via `verifyUserCredentials` / `getUserRole`.
 */
export async function upsertUser(userId: string, password: string, role: UserRole): Promise<void> {
  const pool = getPool();
  await ensureSchema(pool);
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST_FACTOR);

  if (!pool) {
    memoryUsers.set(userId, { userId, passwordHash, role });
    return;
  }

  await pool.query(
    `INSERT INTO users (user_id, password_hash, role, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, updated_at = NOW()`,
    [userId, passwordHash, role],
  );
}

/**
 * Seeds the operator accounts named in `ADMIN_USER_IDS` / `AGENT_USER_IDS`
 * the first time this module is used, if they don't already exist in the
 * store. This is a bootstrap convenience only — it never overwrites an
 * existing row, so once an operator's password has been changed through a
 * real credential-management flow, this seeding step leaves them alone.
 *
 * The bootstrap password comes from `ADMIN_BOOTSTRAP_PASSWORD` /
 * `AGENT_BOOTSTRAP_PASSWORD`, falling back to `STUB_PASSWORD` so existing
 * deployments that only ever configured the old stub keep working for their
 * first login after upgrading — operators should rotate it immediately via
 * `upsertUser`.
 */
async function seedBootstrapOperatorsOnce(): Promise<void> {
  const pool = getPool();
  await ensureSchema(pool);

  const admins = (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const agents = (process.env.AGENT_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? process.env.STUB_PASSWORD;
  const agentPassword = process.env.AGENT_BOOTSTRAP_PASSWORD ?? process.env.STUB_PASSWORD;

  for (const userId of admins) {
    if (!adminPassword) continue;
    const existing = await findUser(pool, userId);
    if (existing) continue;
    console.warn(`[userStore] Seeding bootstrap admin account "${userId}" from ADMIN_USER_IDS. Rotate its password after first login.`);
    await upsertUser(userId, adminPassword, 'admin');
  }

  for (const userId of agents) {
    if (!agentPassword) continue;
    const existing = await findUser(pool, userId);
    if (existing) continue;
    console.warn(`[userStore] Seeding bootstrap agent account "${userId}" from AGENT_USER_IDS. Rotate its password after first login.`);
    await upsertUser(userId, agentPassword, 'agent');
  }
}

function ensureBootstrapSeeded(): Promise<void> {
  if (!bootstrapSeeded) {
    bootstrapSeeded = seedBootstrapOperatorsOnce().catch((err) => {
      console.error('[userStore] Bootstrap operator seeding failed', err);
      // Allow a retry on the next call rather than caching a failure forever.
      bootstrapSeeded = null;
    });
  }
  return bootstrapSeeded;
}

/**
 * Verifies a password against the stored per-user bcrypt hash.
 *
 * Returns false for any unknown userId — this is the behavioural change
 * from the old stub, which "authenticated" any userId against one shared
 * secret. A caller with a valid password for one identity can no longer
 * use it to authenticate as a different one.
 */
export async function verifyUserCredentials(userId: string, password: string): Promise<boolean> {
  await ensureBootstrapSeeded();
  const pool = getPool();
  const user = await findUser(pool, userId);
  if (!user) return false;

  return bcrypt.compare(password, user.passwordHash);
}

/**
 * Resolves a user's role from the store. Falls back to `'user'` for any
 * identity that authenticated but has no row yet (should not normally
 * happen, since `verifyUserCredentials` already requires a row to exist).
 */
export async function getUserRole(userId: string): Promise<UserRole> {
  await ensureBootstrapSeeded();
  const pool = getPool();
  const user = await findUser(pool, userId);
  return user?.role ?? 'user';
}

/** Test helper — clears the in-memory fallback store and cached init state. */
export function resetUserStoreForTests(): void {
  memoryUsers.clear();
  schemaReady = null;
  bootstrapSeeded = null;
}
