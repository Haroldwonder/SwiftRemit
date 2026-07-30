-- Migration: add_device_tokens
-- Stores Expo push tokens for registered mobile devices.
-- One user can have multiple devices; tokens must be globally unique.

CREATE TABLE IF NOT EXISTS device_tokens (
  id            BIGSERIAL     PRIMARY KEY,
  user_id       TEXT          NOT NULL,
  token         TEXT          NOT NULL,
  platform      TEXT          NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_device_tokens_token UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens (user_id);

-- Automatically update updated_at on every write
CREATE OR REPLACE FUNCTION update_device_tokens_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_tokens_updated_at ON device_tokens;
CREATE TRIGGER trg_device_tokens_updated_at
  BEFORE UPDATE ON device_tokens
  FOR EACH ROW EXECUTE FUNCTION update_device_tokens_updated_at();
