-- Rollback: add_correlation_id_to_jobs_and_events (SR-035)

DROP INDEX IF EXISTS idx_job_runs_correlation_id;
ALTER TABLE job_runs DROP COLUMN IF EXISTS correlation_id;

DROP INDEX IF EXISTS idx_contract_events_correlation_id;
ALTER TABLE contract_events DROP COLUMN IF EXISTS correlation_id;
