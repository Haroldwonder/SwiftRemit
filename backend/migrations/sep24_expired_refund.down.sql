-- Rollback: sep24_expired_refund (SR-036)
-- Removes the partial index added for the expired/refunded idempotency check.
-- No table or column changes were made by the up migration, so this is safe.

DROP INDEX IF EXISTS idx_sep24_status_refunded;
