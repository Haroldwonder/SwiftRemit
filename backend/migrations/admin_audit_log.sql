-- Migration: admin_audit_log
-- Creates the admin_audit_log table for off-chain compliance audit trail.
-- Idempotent: uses CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  admin_address VARCHAR(56)  NOT NULL,
  action        VARCHAR(100) NOT NULL,
  target        VARCHAR(255),
  params_json   JSONB,
  tx_hash       VARCHAR(64),
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_admin_address ON admin_audit_log(admin_address);
CREATE INDEX IF NOT EXISTS idx_audit_action        ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created_at    ON admin_audit_log(created_at DESC);

-- Retention: rows older than AUDIT_RETENTION_DAYS (default 90) can be purged by a scheduled job.
-- Example purge query (run via cron or pg_cron):
-- DELETE FROM admin_audit_log WHERE created_at < NOW() - INTERVAL '90 days';
