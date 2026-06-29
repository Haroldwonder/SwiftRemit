-- Rollback for kyc_status_schema.sql
-- Reverts KYC status schema additions.

ALTER TABLE anchors
  DROP COLUMN IF EXISTS kyc_endpoint;

DROP TABLE IF EXISTS user_kyc_status;
