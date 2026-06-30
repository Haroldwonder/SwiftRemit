-- Track when each anchor's stellar.toml was last validated
ALTER TABLE anchors
  ADD COLUMN IF NOT EXISTS toml_validated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS toml_signing_key  VARCHAR(56);
