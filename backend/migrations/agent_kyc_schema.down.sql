-- Rollback: agent_kyc_schema (SR-036)
--
-- DESTRUCTIVE: permanently deletes the agent_kyc table and all KYC records.
-- Review sign-off required before applying in production.
-- Ensure a full database backup exists before running this rollback.

DROP INDEX IF EXISTS idx_agent_kyc_status;
DROP INDEX IF EXISTS idx_agent_kyc_agent_id;

-- DESTRUCTIVE: all agent KYC records are lost.
DROP TABLE IF EXISTS agent_kyc;
