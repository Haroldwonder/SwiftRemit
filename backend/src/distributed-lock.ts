import { Pool } from 'pg';

/**
 * Converts a string key to a stable 32-bit integer for use as a PostgreSQL
 * advisory lock key. Uses a simple djb2-style hash.
 */
function keyToInt(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) >>> 0; // keep unsigned 32-bit
  }
  // pg_try_advisory_lock takes bigint; we use the value as-is (fits in int4 range via cast)
  return h >>> 1; // ensure positive signed 32-bit
}

/**
 * Acquires a session-level PostgreSQL advisory lock for the duration of `fn`.
 * Uses pg_try_advisory_lock (non-blocking): if the lock is already held by
 * another instance, `fn` is skipped for this run.
 *
 * @returns true if the job ran, false if it was skipped (lock not acquired).
 */
export async function withAdvisoryLock(
  pool: Pool,
  lockKey: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  const lockId = keyToInt(lockKey);
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [lockId],
    );
    if (!rows[0].acquired) {
      return false;
    }
    try {
      await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
    }
    return true;
  } finally {
    client.release();
  }
}
