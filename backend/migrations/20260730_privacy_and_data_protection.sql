-- Migration: Privacy & Data Protection Schema (GDPR & Column-Level Encryption)

-- User Consent Tracking Table
CREATE TABLE IF NOT EXISTS user_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    consent_type VARCHAR(100) NOT NULL, -- 'terms_of_service', 'privacy_policy', 'marketing'
    policy_version VARCHAR(50) NOT NULL,
    agreed BOOLEAN NOT NULL DEFAULT true,
    agreed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE,
    ip_address VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user ON user_consents(user_id);

-- Privacy Rights Requests Table (SAR, Rectification, Erasure)
CREATE TABLE IF NOT EXISTS privacy_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    request_type VARCHAR(50) NOT NULL, -- 'access', 'rectification', 'erasure'
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'completed', 'legal_hold', 'rejected'
    details JSONB,
    legal_hold_carveout BOOLEAN DEFAULT false,
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_user ON privacy_requests(user_id);
