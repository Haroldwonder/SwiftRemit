-- Rollback for add_memo_to_remittances.sql
-- Removes the optional memo field from transactions.

ALTER TABLE transactions
  DROP COLUMN IF EXISTS memo;
