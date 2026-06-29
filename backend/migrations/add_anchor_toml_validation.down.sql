-- Rollback for add_anchor_toml_validation.sql
-- Removes TOML validation metadata from anchors.

ALTER TABLE anchors
  DROP COLUMN IF EXISTS toml_validated_at,
  DROP COLUMN IF EXISTS toml_signing_key;
