-- Rollback for add_webhook_dead_letters.sql
-- Drops the dead-letter queue table for permanently failed webhook deliveries.

DROP TABLE IF EXISTS webhook_dead_letters;
