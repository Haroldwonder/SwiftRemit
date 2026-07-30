import { Pool } from 'pg';
import type { JobRun } from '../job-tracker';

export class JobRunRepository {
  constructor(private readonly pool: Pool) {}

  async insertRunning(jobName: string): Promise<number> {
    const { rows } = await this.pool.query<{ id: number }>(
      `INSERT INTO job_runs (job_name, started_at, status) VALUES ($1, NOW(), 'running') RETURNING id`,
      [jobName]
    );
    return rows[0].id;
  }

  async markSuccess(runId: number): Promise<void> {
    await this.pool.query(
      `UPDATE job_runs SET finished_at = NOW(), status = 'success' WHERE id = $1`,
      [runId]
    );
  }

  async markFailure(runId: number, errorMessage: string): Promise<void> {
    await this.pool.query(
      `UPDATE job_runs SET finished_at = NOW(), status = 'failure', error = $2 WHERE id = $1`,
      [runId, errorMessage]
    );
  }

  async getDistinctJobNames(): Promise<string[]> {
    const { rows } = await this.pool.query<{ job_name: string }>(
      `SELECT DISTINCT job_name FROM job_runs ORDER BY job_name`
    );
    return rows.map(r => r.job_name);
  }

  async getLastRun(jobName: string): Promise<Pick<JobRun, 'started_at' | 'status'> | undefined> {
    const { rows } = await this.pool.query<Pick<JobRun, 'started_at' | 'status'>>(
      `SELECT started_at, status FROM job_runs WHERE job_name = $1 ORDER BY started_at DESC LIMIT 1`,
      [jobName]
    );
    return rows[0];
  }

  async getFailureCount24h(jobName: string): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM job_runs
       WHERE job_name = $1 AND status = 'failure' AND started_at > NOW() - INTERVAL '24 hours'`,
      [jobName]
    );
    return parseInt(rows[0].count, 10);
  }

  async getRecentRuns(jobName: string, limit: number = 10): Promise<JobRun[]> {
    const { rows } = await this.pool.query<JobRun>(
      `SELECT * FROM job_runs WHERE job_name = $1 ORDER BY started_at DESC LIMIT $2`,
      [jobName, limit]
    );
    return rows;
  }
}
