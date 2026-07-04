import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runTracked, getJobSummaries } from '../job-tracker';

function makeMockPool(queryImpl: (sql: string, params?: unknown[]) => { rows: unknown[] }): Pool {
  return { query: vi.fn().mockImplementation(queryImpl) } as unknown as Pool;
}

describe('runTracked', () => {
  it('inserts a running row and updates to success', async () => {
    const calls: [string, unknown[]][] = [];
    const pool = makeMockPool((sql, params = []) => {
      calls.push([sql, params]);
      if (sql.includes('INSERT')) return { rows: [{ id: 42 }] };
      return { rows: [] };
    });

    await runTracked(pool, 'test-job', async () => {});

    expect(calls[0][0]).toContain("status) VALUES ($1, NOW(), 'running')");
    expect(calls[1][0]).toContain("status = 'success'");
  });

  it('updates to failure and rethrows on error', async () => {
    const calls: [string, unknown[]][] = [];
    const pool = makeMockPool((sql, params = []) => {
      calls.push([sql, params]);
      if (sql.includes('INSERT')) return { rows: [{ id: 7 }] };
      return { rows: [] };
    });

    await expect(
      runTracked(pool, 'bad-job', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    const updateCall = calls.find(([sql]) => sql.includes("status = 'failure'"));
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain('boom');
  });

  it('records metrics on success', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('INSERT')) return { rows: [{ id: 1 }] };
      return { rows: [] };
    });

    // Import MetricsService to verify it's called
    const { getMetricsService } = await import('../metrics');
    const metrics = getMetricsService(pool);
    const spy = vi.spyOn(metrics, 'recordJobRun');

    await runTracked(pool, 'my-job', async () => {});
    expect(spy).toHaveBeenCalledWith('my-job');
  });

  it('records job failure metric on error', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('INSERT')) return { rows: [{ id: 1 }] };
      return { rows: [] };
    });

    const { getMetricsService } = await import('../metrics');
    const metrics = getMetricsService(pool);
    const spy = vi.spyOn(metrics, 'recordJobFailure');

    await runTracked(pool, 'fail-job', async () => { throw new Error('x'); }).catch(() => {});
    expect(spy).toHaveBeenCalledWith('fail-job');
  });
});

describe('getJobSummaries', () => {
  it('returns per-job summaries', async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes('DISTINCT')) return { rows: [{ job_name: 'job-a' }] };
      if (sql.includes('LIMIT 1')) return { rows: [{ started_at: new Date('2024-01-01'), status: 'success' }] };
      if (sql.includes("= 'failure'")) return { rows: [{ count: '2' }] };
      return { rows: [] }; // recent runs
    });

    const summaries = await getJobSummaries(pool);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].job_name).toBe('job-a');
    expect(summaries[0].last_status).toBe('success');
    expect(summaries[0].failure_count_24h).toBe(2);
  });

  it('returns empty array when no jobs have run', async () => {
    const pool = makeMockPool(() => ({ rows: [] }));
    const summaries = await getJobSummaries(pool);
    expect(summaries).toHaveLength(0);
  });
});

describe('MetricsService job metrics', () => {
  it('exposes swiftremit_job_last_run_timestamp in Prometheus output', async () => {
    const { MetricsService } = await import('../metrics');
    const service = new MetricsService({} as Pool);
    service.recordJobRun('poll-kyc-statuses');
    const output = service.generatePrometheusText();
    expect(output).toContain('swiftremit_job_last_run_timestamp{job_name="poll-kyc-statuses"}');
  });

  it('exposes swiftremit_job_failure_total in Prometheus output', async () => {
    const { MetricsService } = await import('../metrics');
    const service = new MetricsService({} as Pool);
    service.recordJobFailure('revalidate-stale-assets');
    service.recordJobFailure('revalidate-stale-assets');
    const output = service.generatePrometheusText();
    expect(output).toContain('swiftremit_job_failure_total{job_name="revalidate-stale-assets"} 2');
  });
});
