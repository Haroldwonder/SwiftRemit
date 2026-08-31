-- SR-027: DLQ monitoring, auto-retry, auto-disable, and bulk-replay
--
-- 1. Add owner_email to webhook_subscribers so we can notify subscription owners.
-- 2. Add consecutive_failures counter to webhook_subscribers for auto-disable logic.
-- 3. Add subscription_id to webhook_dead_letters for per-subscription metrics.
--
-- NOTE: this used to ALTER a table literally named `webhooks`, which no
-- migration anywhere creates — the real outbound-webhook table is
-- `webhook_subscribers` (see 20260101_core_schema.sql). That made this
-- migration fail unconditionally with "relation \"webhooks\" does not exist".

-- Add owner contact fields to webhook_subscribers
ALTER TABLE webhook_subscribers
  ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP;

-- Index to quickly find subscriptions with high consecutive failures
CREATE INDEX IF NOT EXISTS idx_webhooks_consecutive_failures
  ON webhook_subscribers(consecutive_failures)
  WHERE active = TRUE;

-- Add subscription_id to DLQ for per-subscription depth queries.
-- Mirrors webhook_id but uses the explicit FK name the task uses.
ALTER TABLE webhook_dead_letters
  ADD COLUMN IF NOT EXISTS subscription_id UUID;

-- Back-fill: treat webhook_id as the subscription_id for existing rows
UPDATE webhook_dead_letters
  SET subscription_id = webhook_id
  WHERE subscription_id IS NULL;

-- Index for per-subscription DLQ depth gauge query
CREATE INDEX IF NOT EXISTS idx_webhook_dead_letters_subscription
  ON webhook_dead_letters(subscription_id)
  WHERE replayed_at IS NULL;

-- Add expiry tracking column (set by the auto-expiry scheduler)
ALTER TABLE webhook_dead_letters
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMP;

-- Add retry scheduling column (null = eligible immediately)
ALTER TABLE webhook_dead_letters
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_webhook_dead_letters_retry
  ON webhook_dead_letters(next_retry_at)
  WHERE replayed_at IS NULL AND expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_dead_letters_expired
  ON webhook_dead_letters(created_at)
  WHERE expired_at IS NULL AND replayed_at IS NULL;
