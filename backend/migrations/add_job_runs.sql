-- Migration: add_job_runs
-- Creates the job_runs table for background job monitoring (#866).

CREATE TABLE IF NOT EXISTS job_runs (
  id          BIGSERIAL    PRIMARY KEY,
  job_name    VARCHAR(100) NOT NULL,
  started_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP,
  status      VARCHAR(10)  NOT NULL CHECK (status IN ('running', 'success', 'failure')),
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_runs_job_name   ON job_runs(job_name);
CREATE INDEX IF NOT EXISTS idx_job_runs_started_at ON job_runs(started_at DESC);
