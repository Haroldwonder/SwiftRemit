/**
 * Database migration runner
 *
 * - Tracks applied migrations in schema_migrations table
 * - Runs pending migrations on startup in filename order
 * - Supports rollback of the last applied migration (if a .down.sql exists)
 *
 * Usage:
 *   npm run migrate            — apply all pending migrations
 *   npm run migrate:rollback   — roll back the last applied migration
 */

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

// ─── helpers ────────────────────────────────────────────────────────────────

function getPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'swiftremit',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      filename    VARCHAR(255) NOT NULL UNIQUE,
      applied_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
      checksum    VARCHAR(64)  NOT NULL
    )
  `);
}

function checksum(content: string): string {
  // Simple djb2 hash — no crypto dependency needed
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
    hash = hash >>> 0; // keep 32-bit unsigned
  }
  return hash.toString(16).padStart(8, '0');
}

/** Return sorted list of .sql migration files (excludes .down.sql) */
function getMigrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();
}

async function getAppliedMigrations(pool: Pool): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY id'
  );
  return new Set(result.rows.map(r => r.filename));
}

// ─── migrate ────────────────────────────────────────────────────────────────

export async function migrate(pool: Pool): Promise<void> {
  await ensureMigrationsTable(pool);

  const applied = await getAppliedMigrations(pool);
  const files = getMigrationFiles();
  const pending = files.filter(f => !applied.has(f));

  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }

  for (const filename of pending) {
    const filePath = path.join(MIGRATIONS_DIR, filename);
    const sql = fs.readFileSync(filePath, 'utf8');
    const hash = checksum(sql);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
        [filename, hash]
      );
      await client.query('COMMIT');
      console.log(`✓ Applied: ${filename}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ Failed:  ${filename}`, err);
      throw err;
    } finally {
      client.release();
    }
  }
}

// ─── rollback ───────────────────────────────────────────────────────────────

export async function rollback(pool: Pool): Promise<void> {
  await ensureMigrationsTable(pool);

  const result = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 1'
  );

  if (result.rows.length === 0) {
    console.log('Nothing to roll back.');
    return;
  }

  const { filename } = result.rows[0];
  const downFile = filename.replace(/\.sql$/, '.down.sql');
  const downPath = path.join(MIGRATIONS_DIR, downFile);

  if (!fs.existsSync(downPath)) {
    throw new Error(
      `No rollback file found for ${filename}. Expected: ${downFile}`
    );
  }

  const sql = fs.readFileSync(downPath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'DELETE FROM schema_migrations WHERE filename = $1',
      [filename]
    );
    await client.query('COMMIT');
    console.log(`↩ Rolled back: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`✗ Rollback failed: ${filename}`, err);
    throw err;
  } finally {
    client.release();
  }
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (require.main === module) {
  const command = process.argv[2] ?? 'migrate';
  const pool = getPool();

  const run = command === 'rollback' ? rollback : migrate;

  run(pool)
    .then(() => pool.end())
    .catch(err => {
      console.error(err);
      pool.end();
      process.exit(1);
    });
}
