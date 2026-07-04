-- Compliance reporting tables for FINCEN/FATF threshold-based flagging

CREATE TABLE IF NOT EXISTS compliance_thresholds (
  id            SERIAL PRIMARY KEY,
  corridor      VARCHAR(20) NOT NULL,           -- e.g. 'USD/PHP'
  currency      VARCHAR(10) NOT NULL,
  threshold     NUMERIC(20, 2) NOT NULL,
  jurisdiction  VARCHAR(100),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(corridor, currency)
);

CREATE INDEX IF NOT EXISTS idx_compliance_thresholds_corridor ON compliance_thresholds(corridor);

CREATE TABLE IF NOT EXISTS compliance_flagged_remittances (
  id              SERIAL PRIMARY KEY,
  transaction_id  VARCHAR(255) NOT NULL REFERENCES transactions(transaction_id) ON DELETE CASCADE,
  corridor        VARCHAR(20),
  amount          NUMERIC(20, 7) NOT NULL,
  currency        VARCHAR(10) NOT NULL,
  threshold_id    INTEGER REFERENCES compliance_thresholds(id),
  status          VARCHAR(30) NOT NULL DEFAULT 'pending',  -- pending | reported | cleared
  flagged_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reported_at     TIMESTAMPTZ,
  cleared_at      TIMESTAMPTZ,
  notes           TEXT,
  UNIQUE(transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_flagged_remittances_status    ON compliance_flagged_remittances(status);
CREATE INDEX IF NOT EXISTS idx_flagged_remittances_flagged_at ON compliance_flagged_remittances(flagged_at);
CREATE INDEX IF NOT EXISTS idx_flagged_remittances_currency  ON compliance_flagged_remittances(currency);

CREATE TABLE IF NOT EXISTS compliance_report_audit (
  id            SERIAL PRIMARY KEY,
  accessed_by   VARCHAR(255) NOT NULL,
  ip_address    VARCHAR(64),
  export_format VARCHAR(10),
  filters       JSONB,
  row_count     INTEGER,
  accessed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_audit_accessed_at ON compliance_report_audit(accessed_at);
