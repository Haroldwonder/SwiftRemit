-- Rollback for add_admin_audit_log_purge_index.sql
-- Removes the dedicated index used for purge operations.

DROP INDEX IF EXISTS idx_admin_audit_log_created_at;
