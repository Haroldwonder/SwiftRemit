ALTER TABLE webhook_subscribers
  DROP COLUMN IF EXISTS previous_secret,
  DROP COLUMN IF EXISTS secret_rotated_at;
