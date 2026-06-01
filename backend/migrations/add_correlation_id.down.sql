-- Rollback for add_correlation_id.sql
-- Removes correlation ID columns and related indexes.

DROP INDEX IF EXISTS idx_webhook_logs_correlation;
DROP INDEX IF EXISTS idx_suspicious_webhooks_correlation;

ALTER TABLE webhook_logs
  DROP COLUMN IF EXISTS correlation_id;

ALTER TABLE suspicious_webhooks
  DROP COLUMN IF EXISTS correlation_id;
