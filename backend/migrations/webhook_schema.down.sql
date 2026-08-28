-- Rollback: webhook_schema (SR-036)
--
-- DESTRUCTIVE: drops all webhook infrastructure tables and their data,
-- including all delivery history, dead letters, subscriber configuration,
-- notification preferences, KYC uploads, transactions, and anchors.
-- Review sign-off required before applying in production.
-- Ensure a full database backup exists before running this rollback.

-- Drop indexes first (most are dropped implicitly with their table, but listed
-- for tables that have non-implicit indexes we might have created separately)

-- kyc_uploads
DROP INDEX IF EXISTS idx_kyc_uploads_created;
DROP INDEX IF EXISTS idx_kyc_uploads_status;
DROP INDEX IF EXISTS idx_kyc_uploads_anchor;
DROP INDEX IF EXISTS idx_kyc_uploads_user;
-- DESTRUCTIVE
DROP TABLE IF EXISTS kyc_uploads;

-- notification_preferences
DROP INDEX IF EXISTS idx_notification_preferences_sms;
DROP INDEX IF EXISTS idx_notification_preferences_email;
-- DESTRUCTIVE
DROP TABLE IF EXISTS notification_preferences;

-- webhook_dead_letters
DROP INDEX IF EXISTS idx_webhook_dead_letters_created;
DROP INDEX IF EXISTS idx_webhook_dead_letters_event_type;
DROP INDEX IF EXISTS idx_webhook_dead_letters_webhook;
-- DESTRUCTIVE
DROP TABLE IF EXISTS webhook_dead_letters;

-- webhook_deliveries (FK → webhook_subscribers)
DROP INDEX IF EXISTS idx_webhook_deliveries_subscriber;
DROP INDEX IF EXISTS idx_webhook_deliveries_pending;
DROP INDEX IF EXISTS idx_webhook_deliveries_status;
-- DESTRUCTIVE
DROP TABLE IF EXISTS webhook_deliveries;

-- webhook_subscribers is now owned by 20260101_core_schema.sql — its rollback
-- drops it (run that rollback after this one).

-- transaction_state_history
DROP INDEX IF EXISTS idx_state_history_changed;
DROP INDEX IF EXISTS idx_state_history_transaction;
-- DESTRUCTIVE
DROP TABLE IF EXISTS transaction_state_history;

-- transactions and anchors are now owned by 20260101_core_schema.sql — its
-- rollback drops them (run that rollback after this one).

-- suspicious_webhooks
DROP INDEX IF EXISTS idx_suspicious_webhooks_detected;
DROP INDEX IF EXISTS idx_suspicious_webhooks_anchor;
-- DESTRUCTIVE
DROP TABLE IF EXISTS suspicious_webhooks;

-- webhook_logs
DROP INDEX IF EXISTS idx_webhook_logs_received;
DROP INDEX IF EXISTS idx_webhook_logs_transaction;
DROP INDEX IF EXISTS idx_webhook_logs_anchor;
-- DESTRUCTIVE
DROP TABLE IF EXISTS webhook_logs;
