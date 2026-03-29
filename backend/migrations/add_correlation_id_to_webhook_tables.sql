-- Add correlation_id column to webhook_logs table
ALTER TABLE webhook_logs
ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(36);

-- Add correlation_id column to suspicious_webhooks table
ALTER TABLE suspicious_webhooks
ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(36);

-- Create indexes for correlation_id columns
CREATE INDEX IF NOT EXISTS idx_webhook_logs_correlation_id ON webhook_logs (correlation_id);

CREATE INDEX IF NOT EXISTS idx_suspicious_webhooks_correlation_id ON suspicious_webhooks (correlation_id);

-- Update transaction_state_history to include correlation_id
ALTER TABLE transaction_state_history
ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(36);

-- Create index for correlation_id in transaction_state_history
CREATE INDEX IF NOT EXISTS idx_state_history_correlation_id ON transaction_state_history (correlation_id);