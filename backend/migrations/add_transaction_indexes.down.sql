-- Rollback for add_transaction_indexes.sql
-- Removes transaction indexes and the sender_address column if it was added.

DROP INDEX IF EXISTS idx_transactions_sender_created;
DROP INDEX IF EXISTS idx_transactions_sender;
DROP INDEX IF EXISTS idx_transactions_status_created;

ALTER TABLE transactions
  DROP COLUMN IF EXISTS sender_address;
