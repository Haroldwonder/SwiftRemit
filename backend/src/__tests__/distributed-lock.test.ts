import { describe, it, expect, vi } from 'vitest';
import { Pool, PoolClient } from 'pg';
import { withAdvisoryLock } from '../distributed-lock';

/** Simulates a single shared Postgres advisory-lock table across "replicas". */
function makeSharedLockPool(): { pool: Pool; heldLocks: Set<number> } {
  const heldLocks = new Set<number>();

  function makeClient(): Partial<PoolClient> {
    return {
      query: vi.fn().mockImplementation((sql: string, params: unknown[] = []) => {
        if (sql.includes('pg_try_advisory_lock')) {
          const lockId = params[0] as number;
          if (heldLocks.has(lockId)) {
            return Promise.resolve({ rows: [{ acquired: false }] });
          }
          heldLocks.add(lockId);
          return Promise.resolve({ rows: [{ acquired: true }] });
        }
        if (sql.includes('pg_advisory_unlock')) {
          const lockId = params[0] as number;
          heldLocks.delete(lockId);
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
  }

  const pool = {
    connect: vi.fn().mockImplementation(() => Promise.resolve(makeClient())),
  } as unknown as Pool;

  return { pool, heldLocks };
}

describe('withAdvisoryLock', () => {
  it('runs fn and releases the lock when acquired', async () => {
    const { pool, heldLocks } = makeSharedLockPool();
    const fn = vi.fn().mockResolvedValue(undefined);

    const ran = await withAdvisoryLock(pool, 'poll-kyc-statuses', fn);

    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
    expect(heldLocks.size).toBe(0); // released after run
  });

  it('skips fn when another replica already holds the lock', async () => {
    const { pool } = makeSharedLockPool();
    const fn = vi.fn().mockResolvedValue(undefined);

    // First replica acquires and holds the lock (never resolves within this tick)
    let releaseFirst!: () => void;
    const firstRun = withAdvisoryLock(pool, 'poll-kyc-statuses', () => new Promise(resolve => {
      releaseFirst = resolve;
    }));

    // Give the first call a chance to acquire the lock before the second attempts it
    await new Promise(resolve => setImmediate(resolve));

    const secondRan = await withAdvisoryLock(pool, 'poll-kyc-statuses', fn);
    expect(secondRan).toBe(false);
    expect(fn).not.toHaveBeenCalled();

    releaseFirst();
    expect(await firstRun).toBe(true);
  });

  it('a lock is available again for the next poll after the holder releases it (no permanent hold on crash/exit)', async () => {
    const { pool, heldLocks } = makeSharedLockPool();

    await withAdvisoryLock(pool, 'poll-kyc-statuses', async () => {});
    expect(heldLocks.size).toBe(0);

    const ranAgain = await withAdvisoryLock(pool, 'poll-kyc-statuses', async () => {});
    expect(ranAgain).toBe(true);
  });

  it('still releases the lock when fn throws', async () => {
    const { pool, heldLocks } = makeSharedLockPool();

    await expect(
      withAdvisoryLock(pool, 'poll-kyc-statuses', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    expect(heldLocks.size).toBe(0);
  });

  it('produces exactly one job run when two replicas poll the same anchor concurrently', async () => {
    const { pool } = makeSharedLockPool();
    let writes = 0;
    const job = async () => { writes++; };

    const [ranA, ranB] = await Promise.all([
      withAdvisoryLock(pool, 'poll-kyc-statuses', job),
      withAdvisoryLock(pool, 'poll-kyc-statuses', job),
    ]);

    expect([ranA, ranB].filter(Boolean)).toHaveLength(1);
    expect(writes).toBe(1);
  });
});
