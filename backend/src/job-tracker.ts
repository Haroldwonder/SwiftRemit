import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { getMetricsService } from './metrics';
import { correlationStorage, createLogger } from './correlation-id';

const logger = createLogger('job-tracker');

export interface JobRun {
  id: number;
  job_name: string;
  started_at: Date;
  finished_at: Date | null;
  status: 'running' | 'success' | 'failure';
  error: string | null;
  correlation_id: string | null;
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
 *
 * A fresh correlation ID is generated for every run and stored in `job_runs`.
 * The job function executes inside an AsyncLocalStorage context so that every
 * log line and outbound call made during the run automatically carries the ID.
 */
export async function runTracked(
  pool: Pool,
  jobName: string,
  fn: () => Promise<void>
): Promise<void> {
  // Generate a correlation ID scoped to this job execution
  const correlationId = uuidv4();

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO job_runs (job_name, started_at, status, correlation_id)
     VALUES ($1, NOW(), 'running', $2) RETURNING id`,
    [jobName, correlationId]
  );
  const runId = rows[0].id;
  const metrics = getMetricsService(pool);

  logger.info(`Job started`, { jobName, runId, correlationId });

  // Run the job function inside the ALS context so getCorrelationId() works
  // throughout the entire async call-tree of this job run.
  await correlationStorage.run(correlationId, async () => {
    try {
      await fn();
      await pool.query(
        `UPDATE job_runs SET finished_at = NOW(), status = 'success' WHERE id = $1`,
        [runId]
      );
      metrics.recordJobRun(jobName);
      logger.info(`Job completed successfully`, { jobName, runId, correlationId });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await pool.query(
        `UPDATE job_runs SET finished_at = NOW(), status = 'failure', error = $2 WHERE id = $1`,
        [runId, errorMsg]
      );
      metrics.recordJobFailure(jobName);
      logger.error(`Job failed`, err instanceof Error ? err : new Error(String(err)), {
        jobName,
        runId,
        correlationId,
      });
      throw err;
    }
  });
}

/** Return per-job summaries for the admin dashboard. */
export async function getJobSummaries(pool: Pool): Promise<JobSummary[]> {
  const jobsResult = await pool.query<{ job_name: string }>(
    `SELECT DISTINCT job_name FROM job_runs ORDER BY job_name`
  );

  return Promise.all(
    jobsResult.rows.map(async ({ job_name }) => {
      const [lastRun, failures, recent] = await Promise.all([
        pool.query<Pick<JobRun, 'started_at' | 'status'>>(
          `SELECT started_at, status FROM job_runs WHERE job_name = $1 ORDER BY started_at DESC LIMIT 1`,
          [job_name]
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*) as count FROM job_runs
           WHERE job_name = $1 AND status = 'failure' AND started_at > NOW() - INTERVAL '24 hours'`,
          [job_name]
        ),
        pool.query<JobRun>(
          `SELECT * FROM job_runs WHERE job_name = $1 ORDER BY started_at DESC LIMIT 10`,
          [job_name]
        ),
      ]);

      return {
        job_name,
        last_run_at: lastRun.rows[0]?.started_at ?? null,
        last_status: lastRun.rows[0]?.status ?? null,
        failure_count_24h: parseInt(failures.rows[0].count),
        recent_runs: recent.rows,
      };
    })
  );
}
