import { describe, it, expect, vi } from 'vitest';
import { withAdvisoryLock } from '../distributed-lock';

// ── Pool mock helpers ──────────────────────────────────────────────────────────

function makeClient(acquired: boolean) {
  return {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ acquired }] }) // pg_try_advisory_lock
      .mockResolvedValueOnce({ rows: [] }),             // pg_advisory_unlock
    release: vi.fn(),
  };
}

function makePool(acquired: boolean) {
  const client = makeClient(acquired);
  return {
    connect: vi.fn().mockResolvedValue(client),
    _client: client,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('withAdvisoryLock', () => {
  it('runs the function and returns true when lock is acquired', async () => {
    const pool = makePool(true);
    const fn   = vi.fn().mockResolvedValue(undefined);

    const result = await withAdvisoryLock(pool as any, 'test-job', fn);

    expect(result).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('skips the function and returns false when lock is not acquired', async () => {
    const pool = makePool(false);
    const fn   = vi.fn();

    const result = await withAdvisoryLock(pool as any, 'test-job', fn);

    expect(result).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('releases the lock even when fn throws', async () => {
    const pool = makePool(true);
    const fn   = vi.fn().mockRejectedValue(new Error('job failed'));

    await expect(withAdvisoryLock(pool as any, 'test-job', fn)).rejects.toThrow('job failed');

    // unlock query must still have been called
    expect(pool._client.query).toHaveBeenCalledTimes(2);
    expect(pool._client.release).toHaveBeenCalledOnce();
  });

  it('releases the pool client on error acquiring the lock', async () => {
    const client = {
      query: vi.fn().mockRejectedValue(new Error('pg error')),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) };

    await expect(withAdvisoryLock(pool as any, 'test-job', vi.fn())).rejects.toThrow('pg error');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('produces different lock IDs for different keys', async () => {
    const usedLockIds = new Set<number>();

    for (const key of ['job-a', 'job-b', 'settlement', 'kyc-poll']) {
      const client = makeClient(true);
      const pool   = { connect: vi.fn().mockResolvedValue(client) };

      await withAdvisoryLock(pool as any, key, vi.fn());

      const lockId = client.query.mock.calls[0][1][0] as number;
      expect(typeof lockId).toBe('number');
      expect(lockId).toBeGreaterThanOrEqual(0);
      usedLockIds.add(lockId);
    }

    // All four keys must hash to different values
    expect(usedLockIds.size).toBe(4);
  });

  it('produces the same lock ID for the same key (deterministic hash)', async () => {
    const lockIds: number[] = [];

    for (let i = 0; i < 3; i++) {
      const client = makeClient(true);
      const pool   = { connect: vi.fn().mockResolvedValue(client) };
      await withAdvisoryLock(pool as any, 'deterministic-key', vi.fn());
      lockIds.push(client.query.mock.calls[0][1][0] as number);
    }

    expect(lockIds[0]).toBe(lockIds[1]);
    expect(lockIds[1]).toBe(lockIds[2]);
  });

  it('returns true and calls fn when lock is acquired on first attempt', async () => {
    const pool = makePool(true);
    let ran = false;
    const result = await withAdvisoryLock(pool as any, 'once', async () => { ran = true; });
    expect(result).toBe(true);
    expect(ran).toBe(true);
  });
});
