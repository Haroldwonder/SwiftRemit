-- Migration: SEP-24 expired refund flow (issue #434)
--
-- The sep24_transactions table already has:
--   status VARCHAR(50) — 'refunded' is used as the idempotency sentinel
--   external_transaction_id VARCHAR(255) — stores the on-chain remittance_id
--
-- No schema changes are required; this file documents the contract.
--
-- Idempotency: a transaction with status = 'refunded' will not be processed again.
-- On-chain link: external_transaction_id holds the Soroban remittance_id (u64 as string).

-- Ensure the 'refunded' status is reachable from 'expired' in any CHECK constraints.
-- (The current schema uses VARCHAR with no CHECK on status values, so no ALTER needed.)

-- Index to speed up the idempotency check during polling:
CREATE INDEX IF NOT EXISTS idx_sep24_status_refunded
  ON sep24_transactions (status)
  WHERE status IN ('expired', 'refunded');
