-- Rollback for anchors_catalog_schema.sql
-- Reverts anchor catalog schema additions.

ALTER TABLE anchors
  DROP COLUMN IF EXISTS domain,
  DROP COLUMN IF EXISTS logo_url,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS fees,
  DROP COLUMN IF EXISTS limits,
  DROP COLUMN IF EXISTS compliance,
  DROP COLUMN IF EXISTS supported_currencies,
  DROP COLUMN IF EXISTS processing_time,
  DROP COLUMN IF EXISTS rating,
  DROP COLUMN IF EXISTS total_transactions,
  DROP COLUMN IF EXISTS verified;
