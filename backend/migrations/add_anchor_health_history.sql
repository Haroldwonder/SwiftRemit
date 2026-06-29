-- Migration: add_anchor_health_history.sql
-- Tracks periodic health check results for each configured anchor

CREATE TABLE IF NOT EXISTS anchor_health_history (
  id              BIGSERIAL    PRIMARY KEY,
  anchor_id       VARCHAR(255) NOT NULL,
  status          VARCHAR(20)  NOT NULL CHECK (status IN ('online', 'degraded', 'offline')),
  response_time_ms INTEGER,
  error_message   TEXT,
  checked_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anchor_health_history_anchor_id ON anchor_health_history(anchor_id);
CREATE INDEX IF NOT EXISTS idx_anchor_health_history_checked_at ON anchor_health_history(checked_at);
CREATE INDEX IF NOT EXISTS idx_anchor_health_history_status ON anchor_health_history(status);
