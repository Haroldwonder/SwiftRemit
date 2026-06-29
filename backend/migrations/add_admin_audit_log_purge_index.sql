-- Migration: add_admin_audit_log_purge_index
-- Adds a dedicated index on admin_audit_log(created_at) to support efficient
-- purge operations (DELETE WHERE created_at < cutoff) without a full table scan.
-- Idempotent: IF NOT EXISTS guard makes it safe to run on existing databases.

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at
  ON admin_audit_log(created_at);
