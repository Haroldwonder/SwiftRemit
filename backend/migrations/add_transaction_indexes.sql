-- Migration: add_transaction_indexes
-- Adds performance indexes to the transactions table for common query patterns.
-- Idempotent: uses CREATE INDEX IF NOT EXISTS throughout.

-- Add sender_address column if it doesn't exist (transactions table may predate this column)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS sender_address VARCHAR(56);

-- Index for user transaction history lookups
CREATE INDEX IF NOT EXISTS idx_transactions_sender
  ON transactions(sender_address);

-- Composite index for paginated history queries (sender + newest first)
CREATE INDEX IF NOT EXISTS idx_transactions_sender_created
  ON transactions(sender_address, created_at DESC);

-- Index for pending transaction polling
CREATE INDEX IF NOT EXISTS idx_transactions_status_created
  ON transactions(status, created_at);
