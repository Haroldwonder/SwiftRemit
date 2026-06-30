-- Migration: agent_kyc table
-- Creates the agent_kyc table used for agent business KYC onboarding.
-- sep12_customer_id stores the customer id returned by the SEP-12 anchor.

CREATE TABLE IF NOT EXISTS agent_kyc (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(255) NOT NULL UNIQUE,
  business_registration JSONB,
  owner_id VARCHAR(255),
  operating_country VARCHAR(100),
  payout_address VARCHAR(255),
  contact_email VARCHAR(255),
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected')),
  rejection_reason TEXT,
  sep12_customer_id VARCHAR(255),
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_kyc_agent_id ON agent_kyc(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_kyc_status ON agent_kyc(status);

-- Add sep12_customer_id to existing installations that predate this migration
ALTER TABLE agent_kyc
  ADD COLUMN IF NOT EXISTS sep12_customer_id VARCHAR(255);
