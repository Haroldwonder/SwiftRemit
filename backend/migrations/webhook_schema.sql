-- Webhook logs table
CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anchor_id VARCHAR(255) NOT NULL,
  transaction_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  received_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP,
  processing_time_ms INTEGER
);

CREATE INDEX idx_webhook_logs_anchor ON webhook_logs(anchor_id);
CREATE INDEX idx_webhook_logs_transaction ON webhook_logs(transaction_id);
CREATE INDEX idx_webhook_logs_received ON webhook_logs(received_at DESC);

-- Suspicious webhooks table
CREATE TABLE IF NOT EXISTS suspicious_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID,
  anchor_id VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  payload JSONB NOT NULL,
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  investigated BOOLEAN DEFAULT false,
  investigation_notes TEXT
);

CREATE INDEX idx_suspicious_webhooks_anchor ON suspicious_webhooks(anchor_id);
CREATE INDEX idx_suspicious_webhooks_detected ON suspicious_webhooks(detected_at DESC);

-- Anchors and transactions tables now live in 20260101_core_schema.sql (which
-- is timestamp-prefixed to run first, since many other migrations that sort
-- alphabetically before this file depend on them). Kept out of this file to
-- avoid a duplicate, non-idempotent `CREATE INDEX` collision.

-- Transaction state history
CREATE TABLE IF NOT EXISTS transaction_state_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id VARCHAR(255) NOT NULL,
  from_status VARCHAR(50),
  to_status VARCHAR(50) NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_state_history_transaction ON transaction_state_history(transaction_id);
CREATE INDEX idx_state_history_changed ON transaction_state_history(changed_at DESC);

-- webhook_subscribers also now lives in 20260101_core_schema.sql (see comment
-- above) — sr027_dlq_monitoring.sql and add_webhook_secret_rotation.sql both
-- ALTER it and sort alphabetically before this file.

-- Outbound webhook delivery queue and retries
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(80) NOT NULL,
  event_key VARCHAR(255) NOT NULL,
  subscriber_id UUID NOT NULL REFERENCES webhook_subscribers(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_error TEXT,
  response_status INTEGER,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_webhook_delivery_subscriber_event UNIQUE (event_type, event_key, subscriber_id)
);

CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX idx_webhook_deliveries_pending ON webhook_deliveries(status, next_retry_at);
CREATE INDEX idx_webhook_deliveries_subscriber ON webhook_deliveries(subscriber_id);

-- Dead-letter queue for failed webhook deliveries after max retries
CREATE TABLE IF NOT EXISTS webhook_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL,
  webhook_id UUID NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL,
  last_error TEXT,
  attempts INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  replayed_at TIMESTAMP,
  replayed_by VARCHAR(255)
);

CREATE INDEX idx_webhook_dead_letters_webhook ON webhook_dead_letters(webhook_id);
CREATE INDEX idx_webhook_dead_letters_event_type ON webhook_dead_letters(event_type);
CREATE INDEX idx_webhook_dead_letters_created ON webhook_dead_letters(created_at DESC);

-- Notification preferences for users
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id VARCHAR(56) PRIMARY KEY,
  email VARCHAR(255),
  phone VARCHAR(50),
  email_opt_in BOOLEAN NOT NULL DEFAULT false,
  sms_opt_in BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_preferences_email ON notification_preferences(email_opt_in);
CREATE INDEX idx_notification_preferences_sms ON notification_preferences(sms_opt_in);

-- KYC document uploads table for SEP-12 PUT endpoint
CREATE TABLE IF NOT EXISTS kyc_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(56) NOT NULL,
  anchor_id VARCHAR(255) NOT NULL,
  document_type VARCHAR(100) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size INTEGER NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  upload_attempt INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kyc_uploads_user ON kyc_uploads(user_id);
CREATE INDEX idx_kyc_uploads_anchor ON kyc_uploads(anchor_id);
CREATE INDEX idx_kyc_uploads_status ON kyc_uploads(status);
CREATE INDEX idx_kyc_uploads_created ON kyc_uploads(created_at DESC);
