-- Migration: add_memo_to_remittances.sql
-- Adds an optional memo field to the transactions table for reconciliation purposes.
-- Backward compatible: existing rows will have memo = NULL.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS memo VARCHAR(100);

COMMENT ON COLUMN transactions.memo IS
  'Optional sender-supplied reference note (e.g. invoice number) for reconciliation. Max 100 chars, plain text only.';
