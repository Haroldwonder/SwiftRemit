import { Pool } from 'pg';
import { getMetricsService } from './metrics';
import { JobRunRepository } from './repositories/JobRunRepository';

export interface JobRun {
  id: number;
  job_name: string;
  started_at: Date;
  finished_at: Date | null;
  status: 'running' | 'success' | 'failure';
  error: string | null;
}

export interface JobSummary {
  job_name: string;
  last_run_at: Date | null;
  last_status: string | null;
  failure_count_24h: number;
  recent_runs: JobRun[];
}

/**
 * Wrap a job function with DB-backed run tracking and Prometheus metrics.
 */
export async function runTracked(
  pool: Pool,
  jobName: string,
  fn: () => Promise<void>
): Promise<void> {
  const repo = new JobRunRepository(pool);
  const runId = await repo.insertRunning(jobName);
  const metrics = getMetricsService(pool);
  try {
    await fn();
    await repo.markSuccess(runId);
    metrics.recordJobRun(jobName);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await repo.markFailure(runId, errorMsg);
    metrics.recordJobFailure(jobName);
    throw err;
  }
}

/** Return per-job summaries for the admin dashboard. */
export async function getJobSummaries(pool: Pool): Promise<JobSummary[]> {
  const repo = new JobRunRepository(pool);
  const jobNames = await repo.getDistinctJobNames();

  return Promise.all(
    jobNames.map(async (job_name) => {
      const [lastRun, failureCount24h, recentRuns] = await Promise.all([
        repo.getLastRun(job_name),
        repo.getFailureCount24h(job_name),
        repo.getRecentRuns(job_name),
      ]);

      return {
        job_name,
        last_run_at: lastRun?.started_at ?? null,
        last_status: lastRun?.status ?? null,
        failure_count_24h: failureCount24h,
        recent_runs: recentRuns,
      };
    })
  );
}
