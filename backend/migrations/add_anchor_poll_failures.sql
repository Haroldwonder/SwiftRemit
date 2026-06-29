-- Migration: add_anchor_poll_failures.sql
-- Records per-anchor KYC poll failures for monitoring and alerting

CREATE TABLE IF NOT EXISTS anchor_poll_failures (
  id          BIGSERIAL    PRIMARY KEY,
  anchor_id   VARCHAR(255) NOT NULL,
  error_message TEXT        NOT NULL,
  failed_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anchor_poll_failures_anchor_id ON anchor_poll_failures(anchor_id);
CREATE INDEX IF NOT EXISTS idx_anchor_poll_failures_failed_at ON anchor_poll_failures(failed_at);
