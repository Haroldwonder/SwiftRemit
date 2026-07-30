-- Rollback: add_ip_to_admin_audit_log (SR-036)
-- Removes the ip_address column and its index from admin_audit_log.
--
-- DESTRUCTIVE: drops the ip_address column and all stored IP data.
-- Review sign-off required before applying in production.

DROP INDEX IF EXISTS idx_audit_ip;

ALTER TABLE admin_audit_log
  DROP COLUMN IF EXISTS ip_address;
