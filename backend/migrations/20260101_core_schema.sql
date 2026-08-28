-- Core schema bootstrap: anchors, transactions, webhook_subscribers.
--
-- These three tables are foreign-key/reference targets for a large number of
-- other migrations (add_anchor_toml_validation.sql, anchors_catalog_schema.sql,
-- kyc_status_schema.sql, add_transaction_indexes.sql, add_memo_to_remittances.sql,
-- add_compliance_reporting.sql, add_webhook_secret_rotation.sql,
-- sr027_dlq_monitoring.sql, ...), but were previously only created by
-- webhook_schema.sql — which sorts last alphabetically. On a fresh database,
-- `npm run migrate` would fail at the first alphabetically-earlier migration
-- that assumed one of these tables already existed.
--
-- This migration is timestamp-prefixed with an early date (2026-01-01) so it
-- always runs first, regardless of alphabetical accident. webhook_schema.sql
-- no longer creates these three tables (see that file's comment).

-- Anchors table
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

-- Transactions table
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

CREATE INDEX IF NOT EXISTS idx_transactions_anchor ON transactions(anchor_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_kind ON transactions(kind);

-- Outbound webhook subscribers
CREATE TABLE IF NOT EXISTS webhook_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  secret VARCHAR(255),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_subscribers_active ON webhook_subscribers(active);
