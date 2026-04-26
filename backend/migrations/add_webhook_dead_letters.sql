-- Dead-letter queue for permanently failed webhook deliveries
CREATE TABLE IF NOT EXISTS webhook_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL,
  webhook_id UUID NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL,
  last_error TEXT,
  attempts INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  replayed_at TIMESTAMP
);

CREATE INDEX idx_webhook_dead_letters_webhook ON webhook_dead_letters(webhook_id);
CREATE INDEX idx_webhook_dead_letters_created ON webhook_dead_letters(created_at DESC);
