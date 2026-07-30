/**
 * SR-036 — Migration rollback-parity and up→down→up round-trip tests.
 *
 * These tests run against a real Postgres database.  They are skipped
 * automatically when DATABASE_URL is not set so they do not block local
 * unit-test runs; CI sets the variable before running this suite.
 *
 * What is tested:
 *   1. Parity:   every *.sql file in migrations/ has a matching *.down.sql.
 *   2. Round-trip: migrate up → rollback every migration in reverse → migrate
 *      up again; the schema_migrations count must be the same at start and end.
 *   3. Destructive annotation: every .down.sql that contains a DROP TABLE or
 *      DROP COLUMN statement carries the required -- DESTRUCTIVE comment.
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

// ─── helpers ────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

function getMigrationUpFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();
}

function getDownFile(upFile: string): string {
  return upFile.replace(/\.sql$/, '.down.sql');
}

// ─── 1. Rollback-parity (pure filesystem, no DB needed) ─────────────────────

describe('Migration rollback parity (SR-036)', () => {
  const upFiles = getMigrationUpFiles();

  it('migrations directory contains at least one migration', () => {
    expect(upFiles.length).toBeGreaterThan(0);
  });

  for (const upFile of upFiles) {
    it(`${upFile} has a matching .down.sql`, () => {
      const downPath = path.join(MIGRATIONS_DIR, getDownFile(upFile));
      expect(
        fs.existsSync(downPath),
        `Expected rollback file: ${getDownFile(upFile)}`,
      ).toBe(true);
    });
  }
});

// ─── 2. Destructive annotation check (pure filesystem) ──────────────────────

describe('Destructive rollback annotation (SR-036)', () => {
  const DESTRUCTIVE_PATTERNS = [
    /^\s*DROP\s+TABLE\b/im,
    /^\s*DROP\s+COLUMN\b/im,
    /^\s*TRUNCATE\b/im,
  ];

  const upFiles = getMigrationUpFiles();

  for (const upFile of upFiles) {
    const downFile = getDownFile(upFile);
    const downPath = path.join(MIGRATIONS_DIR, downFile);
    if (!fs.existsSync(downPath)) continue; // parity test will catch this

    const content = fs.readFileSync(downPath, 'utf8');
    const isDestructive = DESTRUCTIVE_PATTERNS.some(re => re.test(content));

    if (isDestructive) {
      it(`${downFile} has -- DESTRUCTIVE annotation`, () => {
        expect(
          content,
          `${downFile} contains destructive SQL but is missing the -- DESTRUCTIVE comment`,
        ).toMatch(/--\s*DESTRUCTIVE/i);
      });
    }
  }
});

// ─── 3. Up→down→up round-trip (requires DATABASE_URL) ───────────────────────

const DB_URL = process.env.DATABASE_URL;
const RUN_DB_TESTS = !!DB_URL;

describe.skipIf(!RUN_DB_TESTS)('Migration up→down→up round-trip (SR-036)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    // Bootstrap the migrations table so migrate() works on a blank DB
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          SERIAL PRIMARY KEY,
        filename    VARCHAR(255) NOT NULL UNIQUE,
        applied_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
        checksum    VARCHAR(64)  NOT NULL,
        failed      BOOLEAN      NOT NULL DEFAULT FALSE,
        error_msg   TEXT
      )
    `);
    await pool.query(`
      ALTER TABLE schema_migrations
        ADD COLUMN IF NOT EXISTS failed    BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS error_msg TEXT
    `);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('applies all migrations successfully (up)', async () => {
    const { migrate } = await import('../migrate');
    await expect(migrate(pool)).resolves.not.toThrow();

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM schema_migrations WHERE failed = false`,
    );
    const upFiles = getMigrationUpFiles();
    expect(parseInt(rows[0].count)).toBe(upFiles.length);
  });

  it('rolls back every migration in reverse order and re-applies (down→up)', async () => {
    const { rollback, migrate } = await import('../migrate');
    const upFiles = getMigrationUpFiles();

    // Roll back all migrations one by one (newest first)
    for (let i = upFiles.length - 1; i >= 0; i--) {
      await expect(rollback(pool)).resolves.not.toThrow();
    }

    // schema_migrations should be empty now
    const { rows: afterDown } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM schema_migrations WHERE failed = false`,
    );
    expect(parseInt(afterDown[0].count)).toBe(0);

    // Re-apply all migrations
    await expect(migrate(pool)).resolves.not.toThrow();

    // Count should be back to full
    const { rows: afterUp } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM schema_migrations WHERE failed = false`,
    );
    expect(parseInt(afterUp[0].count)).toBe(upFiles.length);
  });
});
