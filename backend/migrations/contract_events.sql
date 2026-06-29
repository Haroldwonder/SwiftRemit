-- Migration: contract_events table
-- Stores indexed Soroban contract events for queryable history

CREATE TABLE IF NOT EXISTS contract_events (
  id            SERIAL PRIMARY KEY,
  event_type    VARCHAR(50)  NOT NULL,
  remittance_id BIGINT,
  actor         VARCHAR(56),
  amount        NUMERIC(30, 7),
  fee           NUMERIC(30, 7),
  tx_hash       VARCHAR(64),
  ledger_sequence BIGINT,
  timestamp     TIMESTAMP    NOT NULL DEFAULT NOW(),
  raw_data      JSONB
);

CREATE INDEX IF NOT EXISTS idx_ce_event_type      ON contract_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ce_actor           ON contract_events(actor);
CREATE INDEX IF NOT EXISTS idx_ce_remittance_id   ON contract_events(remittance_id);
CREATE INDEX IF NOT EXISTS idx_ce_timestamp       ON contract_events(timestamp);
