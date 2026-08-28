-- SR-112 follow-up: real per-sender corridor history for the
-- UNUSUAL_CORRIDOR rule.
--
-- TransactionMonitoringService.loadKnownCorridors() previously sourced a
-- sender's "known corridors" baseline from compliance_flagged_remittances,
-- which is populated only when a remittance amount exceeds a reporting
-- threshold (see routes/compliance.ts autoFlagIfAboveThreshold()). That has
-- nothing to do with which corridors a sender has actually used, so
-- knownCorridors was effectively unrelated to real corridor history and
-- unusualCorridorRule's first_use_by_sender detection almost never fired.
--
-- This table is the dedicated corridor-history record: one row per
-- (sender, corridor, transfer), populated on every evaluated transfer by
-- TransactionMonitoringService.recordCorridorUsage().

CREATE TABLE IF NOT EXISTS sender_corridor_history (
  id             SERIAL PRIMARY KEY,
  sender_address VARCHAR(56)  NOT NULL,
  corridor       VARCHAR(20)  NOT NULL,
  transaction_id VARCHAR(255) NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sender_corridor_transaction UNIQUE (sender_address, corridor, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_sender_corridor_history_lookup
  ON sender_corridor_history(sender_address, corridor, created_at DESC);
