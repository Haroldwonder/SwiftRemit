-- Add correlation_id column to webhook_logs table
ALTER TABLE webhook_logs
ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_correlation ON webhook_logs (correlation_id);

-- Add correlation_id column to suspicious_webhooks table
ALTER TABLE suspicious_webhooks
ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_suspicious_webhooks_correlation ON suspicious_webhooks (correlation_id);