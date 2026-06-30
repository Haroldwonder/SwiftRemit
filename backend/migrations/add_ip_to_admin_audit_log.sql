-- Migration: add_ip_to_admin_audit_log
-- Adds ip_address column to admin_audit_log for compliance capture.

ALTER TABLE admin_audit_log
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);

CREATE INDEX IF NOT EXISTS idx_audit_ip ON admin_audit_log(ip_address);
