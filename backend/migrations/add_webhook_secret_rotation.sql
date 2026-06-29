ALTER TABLE webhook_subscribers
  ADD COLUMN IF NOT EXISTS previous_secret VARCHAR(255),
  ADD COLUMN IF NOT EXISTS secret_rotated_at TIMESTAMP;
