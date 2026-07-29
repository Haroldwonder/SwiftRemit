-- Migration: add_correlation_id_to_jobs_and_events (SR-035)
-- Extends correlation ID tracking to scheduled job runs and contract events
-- so a single ID can trace: API request → contract event → DB write → webhook → notification.

-- job_runs: record which correlation ID was active when the job fired
ALTER TABLE job_runs
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_job_runs_correlation_id
  ON job_runs (correlation_id);

-- contract_events: propagate the originating correlation ID into every derived write
ALTER TABLE contract_events
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_contract_events_correlation_id
  ON contract_events (correlation_id);
