-- SR-112 follow-up: atomic SAR reference numbering.
--
-- SarWorkflowService.nextReference() previously derived the next sequence
-- number from `SELECT COUNT(*) FROM sar_reports WHERE reference LIKE ...`
-- with no locking. Two concurrent createFromAlerts() calls within the same
-- calendar year could read the same count before either INSERT committed,
-- producing a unique-constraint violation on sar_reports.reference for one
-- of the two officers.
--
-- This table gives each calendar year a single counter row. Reference
-- assignment becomes one atomic `INSERT ... ON CONFLICT DO UPDATE RETURNING`
-- statement — Postgres serializes concurrent upserts against the same row,
-- so no two callers can ever be handed the same sequence number.

CREATE TABLE IF NOT EXISTS sar_reference_counters (
  year          INTEGER PRIMARY KEY,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed the counter for years that already have SAR reports, so numbering
-- continues from the highest existing sequence rather than restarting at 1.
INSERT INTO sar_reference_counters (year, last_sequence)
SELECT
  split_part(reference, '-', 2)::int AS year,
  MAX(split_part(reference, '-', 3)::int) AS last_sequence
FROM sar_reports
WHERE reference ~ '^SAR-\d{4}-\d{4}$'
GROUP BY split_part(reference, '-', 2)::int
ON CONFLICT (year) DO UPDATE
  SET last_sequence = GREATEST(sar_reference_counters.last_sequence, EXCLUDED.last_sequence);
