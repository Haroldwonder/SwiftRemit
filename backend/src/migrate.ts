import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

/**
 * Compute a SHA-256 checksum of a migration file's contents.
 * SHA-256 replaces the previously used MD5, which is cryptographically broken.
 */
export function checksum(filePath: string): string {
  const contents = fs.readFileSync(filePath, 'utf8');
  return createHash('sha256').update(contents).digest('hex');
}

export interface MigrationRecord {
  filename: string;
  checksum: string;
  applied_at: Date;
}

export class MigrationRunner {
  constructor(private readonly pool: Pool, private readonly migrationsDir: string) {}

  async initTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        checksum   CHAR(64)    NOT NULL,
        applied_at TIMESTAMP   NOT NULL DEFAULT NOW()
      )
    `);
  }

  async run(): Promise<void> {
    await this.initTable();

    const files = fs
      .readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const filePath = path.join(this.migrationsDir, file);
      const hash = checksum(filePath);

      const existing = await this.pool.query<MigrationRecord>(
        'SELECT checksum FROM schema_migrations WHERE filename = $1',
        [file]
      );

      if (existing.rows.length > 0) {
        if (existing.rows[0].checksum !== hash) {
          throw new Error(
            `Checksum mismatch for migration "${file}": file has been tampered with.`
          );
        }
        continue; // already applied
      }

      const sql = fs.readFileSync(filePath, 'utf8');
      await this.pool.query(sql);
      await this.pool.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
        [file, hash]
      );
      console.log(`Applied migration: ${file}`);
    }
  }
}
