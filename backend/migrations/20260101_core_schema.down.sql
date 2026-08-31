-- Rollback: 20260101_core_schema
--
-- DESTRUCTIVE: drops the core anchors/transactions/webhook_subscribers tables
-- and all data in them, plus everything that transitively depends on them via
-- foreign keys (transactions, webhook_deliveries, etc. — see webhook_schema's
-- own rollback for those). Only safe to run if webhook_schema's rollback (and
-- anything else referencing these tables) has already been applied first.

DROP INDEX IF EXISTS idx_webhook_subscribers_active;
DROP TABLE IF EXISTS webhook_subscribers;

DROP INDEX IF EXISTS idx_transactions_kind;
DROP INDEX IF EXISTS idx_transactions_status;
DROP INDEX IF EXISTS idx_transactions_anchor;
DROP TABLE IF EXISTS transactions;

DROP TABLE IF EXISTS anchors;
