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

-- Anchors table (if not exists)
CREATE TABLE IF NOT EXISTS anchors (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  public_key VARCHAR(56) NOT NULL,
  webhook_secret VARCHAR(255),
  home_domain VARCHAR(255),
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Transactions table (if not exists)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id VARCHAR(255) UNIQUE NOT NULL,
  anchor_id VARCHAR(255) NOT NULL REFERENCES anchors(id),
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  status VARCHAR(50) NOT NULL,
  status_eta INTEGER,
  amount_in DECIMAL(20, 7),
  amount_out DECIMAL(20, 7),
  amount_fee DECIMAL(20, 7),
  asset_code VARCHAR(12),
  stellar_transaction_id VARCHAR(64),
  external_transaction_id VARCHAR(255),
  kyc_status VARCHAR(20),
  kyc_fields JSONB,
  kyc_rejection_reason TEXT,
  message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_anchor ON transactions(anchor_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_kind ON transactions(kind);

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

-- Outbound webhook subscribers
CREATE TABLE IF NOT EXISTS webhook_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  secret VARCHAR(255),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_subscribers_active ON webhook_subscribers(active);

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

CREATE INDEX idx_webhook_deliveries_pending ON webhook_deliveries(status, next_retry_at);
CREATE INDEX idx_webhook_deliveries_subscriber ON webhook_deliveries(subscriber_id);
