-- SR-027 rollback
DROP INDEX IF EXISTS idx_webhook_dead_letters_retry;
DROP INDEX IF EXISTS idx_webhook_dead_letters_expired;
DROP INDEX IF EXISTS idx_webhook_dead_letters_subscription;
ALTER TABLE webhook_dead_letters
  DROP COLUMN IF EXISTS next_retry_at,
  DROP COLUMN IF EXISTS expired_at,
  DROP COLUMN IF EXISTS subscription_id;

DROP INDEX IF EXISTS idx_webhooks_consecutive_failures;
ALTER TABLE webhook_subscribers
  DROP COLUMN IF EXISTS disabled_at,
  DROP COLUMN IF EXISTS consecutive_failures,
  DROP COLUMN IF EXISTS owner_email;
