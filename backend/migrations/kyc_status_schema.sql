-- KYC Verification Sync Service: user KYC status table
-- Migration: kyc_status_schema.sql

-- Add kyc_endpoint column to anchors table for polling
ALTER TABLE anchors ADD COLUMN IF NOT EXISTS kyc_endpoint VARCHAR(512);

-- Per-user, per-anchor KYC status store
CREATE TABLE IF NOT EXISTS user_kyc_status (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          VARCHAR(255) NOT NULL,
  anchor_id        VARCHAR(255) NOT NULL REFERENCES anchors(id),
  kyc_status       VARCHAR(20)  NOT NULL CHECK (kyc_status IN ('pending', 'approved', 'rejected')),
  kyc_level        VARCHAR(20)  CHECK (kyc_level IN ('basic', 'intermediate', 'advanced')),
  rejection_reason TEXT,
  verified_at      TIMESTAMP    NOT NULL,
  expires_at       TIMESTAMP,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_anchor UNIQUE (user_id, anchor_id)
);

CREATE INDEX IF NOT EXISTS idx_kyc_status_user_id ON user_kyc_status(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_status_status  ON user_kyc_status(kyc_status);
