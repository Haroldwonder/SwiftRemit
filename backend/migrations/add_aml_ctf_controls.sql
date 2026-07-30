-- SR-112: AML/CTF compliance controls
--
-- Adds the storage layer for:
--   * sanctions / PEP screening (onboarding + periodic rescreening)
--   * transaction monitoring rules and the alert review queue
--   * suspicious-activity reporting (SAR) workflow
--   * FATF travel-rule data collection and transmission records
--   * the enforced data-retention schedule
--
-- Design note: none of these tables carry a foreign key to `transactions`.
-- AML records have their own statutory retention period and must survive the
-- deletion of the underlying operational row (see data_retention_policies).

-- ─── Sanctions / PEP screening ──────────────────────────────────────────────

-- Local mirror of the screening lists. Populated by the list-ingest job from
-- the configured upstream providers (OFAC SDN, EU CFSP, UN, UK HMT, PEP feed).
CREATE TABLE IF NOT EXISTS sanctions_list_entries (
  id             SERIAL PRIMARY KEY,
  list_source    VARCHAR(40)  NOT NULL,             -- OFAC_SDN | EU_CFSP | UN_CONSOLIDATED | UK_HMT | PEP
  entry_type     VARCHAR(20)  NOT NULL DEFAULT 'sanctions'
                 CHECK (entry_type IN ('sanctions', 'pep')),
  external_id    VARCHAR(120),                      -- provider's own record id
  full_name      VARCHAR(400) NOT NULL,
  normalized_name VARCHAR(400) NOT NULL,            -- upper-cased, punctuation stripped
  aliases        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  country        VARCHAR(80),
  date_of_birth  VARCHAR(20),                       -- free-form; lists are inconsistent
  program        VARCHAR(200),                      -- sanctions programme / PEP role
  active         BOOLEAN      NOT NULL DEFAULT TRUE,
  list_published_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (list_source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_sanctions_entries_normalized ON sanctions_list_entries(normalized_name);
CREATE INDEX IF NOT EXISTS idx_sanctions_entries_active     ON sanctions_list_entries(active, entry_type);

-- One row per screening run against one subject.
CREATE TABLE IF NOT EXISTS sanctions_screening_results (
  id             SERIAL PRIMARY KEY,
  subject_type   VARCHAR(20)  NOT NULL
                 CHECK (subject_type IN ('sender', 'recipient', 'agent')),
  subject_id     VARCHAR(255) NOT NULL,             -- stellar address, recipient ref, or agent_id
  subject_name   VARCHAR(400) NOT NULL,
  subject_country VARCHAR(80),
  trigger        VARCHAR(20)  NOT NULL DEFAULT 'onboarding'
                 CHECK (trigger IN ('onboarding', 'periodic', 'manual', 'transaction')),
  outcome        VARCHAR(20)  NOT NULL
                 CHECK (outcome IN ('clear', 'potential_match', 'confirmed_match', 'error')),
  highest_score  NUMERIC(5, 4) NOT NULL DEFAULT 0,  -- 0.0000–1.0000
  matches        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  lists_screened JSONB        NOT NULL DEFAULT '[]'::jsonb,
  screened_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  next_screening_at TIMESTAMPTZ,                    -- drives the periodic rescreen job
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_screening_subject      ON sanctions_screening_results(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_screening_next_due     ON sanctions_screening_results(next_screening_at)
  WHERE next_screening_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_screening_outcome      ON sanctions_screening_results(outcome, screened_at DESC);

-- ─── Transaction monitoring ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS aml_monitoring_rules (
  code           VARCHAR(60)  PRIMARY KEY,
  name           VARCHAR(200) NOT NULL,
  description    TEXT,
  severity       VARCHAR(10)  NOT NULL DEFAULT 'medium'
                 CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  enabled        BOOLEAN      NOT NULL DEFAULT TRUE,
  params         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- The review queue. Every rule hit and every screening hit lands here.
CREATE TABLE IF NOT EXISTS aml_alerts (
  id             SERIAL PRIMARY KEY,
  rule_code      VARCHAR(60)  NOT NULL,             -- monitoring rule code, or SANCTIONS_HIT
  severity       VARCHAR(10)  NOT NULL DEFAULT 'medium'
                 CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  subject_type   VARCHAR(20)  NOT NULL DEFAULT 'sender'
                 CHECK (subject_type IN ('sender', 'recipient', 'agent')),
  subject_id     VARCHAR(255) NOT NULL,
  transaction_id VARCHAR(255),                      -- null for subject-level alerts
  screening_id   INTEGER REFERENCES sanctions_screening_results(id) ON DELETE SET NULL,
  details        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key     VARCHAR(255) NOT NULL,             -- rule_code + subject + window bucket
  status         VARCHAR(30)  NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'in_review', 'closed_no_action', 'escalated', 'reported')),
  assigned_to    VARCHAR(255),
  disposition    VARCHAR(40),                       -- false_positive | true_positive | duplicate | insufficient_data
  disposition_notes TEXT,
  disposed_by    VARCHAR(255),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  closed_at      TIMESTAMPTZ,
  UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_aml_alerts_status    ON aml_alerts(status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_alerts_subject   ON aml_alerts(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_aml_alerts_txn       ON aml_alerts(transaction_id);

-- ─── Suspicious activity reporting ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sar_reports (
  id             SERIAL PRIMARY KEY,
  reference      VARCHAR(80)  NOT NULL UNIQUE,      -- internal SAR reference (SAR-YYYY-NNNN)
  jurisdiction   VARCHAR(10)  NOT NULL,             -- ISO country / region code of the filing FIU
  subject_type   VARCHAR(20)  NOT NULL DEFAULT 'sender',
  subject_id     VARCHAR(255) NOT NULL,
  alert_ids      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  transaction_ids JSONB       NOT NULL DEFAULT '[]'::jsonb,
  narrative      TEXT         NOT NULL,
  total_amount   NUMERIC(20, 2),
  currency       VARCHAR(10),
  status         VARCHAR(20)  NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'under_review', 'filed', 'acknowledged', 'withdrawn')),
  prepared_by    VARCHAR(255) NOT NULL,
  reviewed_by    VARCHAR(255),
  filed_by       VARCHAR(255),
  external_reference VARCHAR(120),                  -- FIU acknowledgement reference
  filed_at       TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  retention_until TIMESTAMPTZ,                      -- set on filing from the retention schedule
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sar_status     ON sar_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sar_subject    ON sar_reports(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_sar_retention  ON sar_reports(retention_until);

-- Immutable audit trail of every SAR state transition (tipping-off controls
-- require us to know exactly who saw and who moved each report).
CREATE TABLE IF NOT EXISTS sar_report_events (
  id             SERIAL PRIMARY KEY,
  sar_id         INTEGER      NOT NULL REFERENCES sar_reports(id) ON DELETE CASCADE,
  from_status    VARCHAR(20),
  to_status      VARCHAR(20)  NOT NULL,
  actor          VARCHAR(255) NOT NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sar_events_sar ON sar_report_events(sar_id, created_at);

-- ─── Travel rule (FATF Recommendation 16) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS travel_rule_transfers (
  id             SERIAL PRIMARY KEY,
  transaction_id VARCHAR(255) NOT NULL UNIQUE,
  jurisdiction   VARCHAR(10)  NOT NULL,
  amount         NUMERIC(20, 7) NOT NULL,
  currency       VARCHAR(10)  NOT NULL,
  threshold_applied NUMERIC(20, 2) NOT NULL,        -- the threshold that triggered collection
  required       BOOLEAN      NOT NULL DEFAULT TRUE,
  originator     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  beneficiary    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  counterparty_vasp VARCHAR(255),
  payload_hash   VARCHAR(64),                       -- sha256 of the transmitted payload
  transmission_status VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (transmission_status IN ('not_required', 'pending', 'transmitted', 'failed', 'rejected')),
  transmission_error TEXT,
  attempts       INTEGER      NOT NULL DEFAULT 0,
  transmitted_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_travel_rule_status ON travel_rule_transfers(transmission_status, created_at);

-- Per-jurisdiction travel-rule thresholds (USD-equivalent).
CREATE TABLE IF NOT EXISTS travel_rule_thresholds (
  jurisdiction   VARCHAR(10)  PRIMARY KEY,
  threshold_usd  NUMERIC(20, 2) NOT NULL,
  regulation     VARCHAR(200),
  active         BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Data retention ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_retention_policies (
  entity         VARCHAR(80)  PRIMARY KEY,          -- logical entity name (see retention.ts)
  retention_days INTEGER      NOT NULL CHECK (retention_days > 0),
  legal_basis    VARCHAR(300) NOT NULL,
  action         VARCHAR(20)  NOT NULL DEFAULT 'delete'
                 CHECK (action IN ('delete', 'anonymize')),
  enabled        BOOLEAN      NOT NULL DEFAULT TRUE,
  last_enforced_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_retention_runs (
  id             SERIAL PRIMARY KEY,
  entity         VARCHAR(80)  NOT NULL,
  rows_affected  INTEGER      NOT NULL DEFAULT 0,
  action         VARCHAR(20)  NOT NULL,
  cutoff         TIMESTAMPTZ  NOT NULL,
  succeeded      BOOLEAN      NOT NULL DEFAULT TRUE,
  error_msg      TEXT,
  ran_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retention_runs_entity ON data_retention_runs(entity, ran_at DESC);

-- ─── Seed: default monitoring rules ────────────────────────────────────────

INSERT INTO aml_monitoring_rules (code, name, description, severity, params) VALUES
  ('STRUCTURING',
   'Structuring / smurfing',
   'Three or more transfers by the same sender that each sit below a reporting threshold but together exceed it within the lookback window.',
   'high',
   '{"lookback_hours": 168, "min_count": 3, "threshold_ratio": 0.9, "aggregate_multiplier": 1.0}'::jsonb),
  ('VELOCITY_COUNT',
   'Transfer count velocity',
   'Sender exceeds the permitted number of transfers within the lookback window.',
   'medium',
   '{"lookback_hours": 24, "max_count": 10}'::jsonb),
  ('VELOCITY_AMOUNT',
   'Transfer value velocity',
   'Sender exceeds the permitted aggregate value within the lookback window.',
   'high',
   '{"lookback_hours": 24, "max_amount": 10000}'::jsonb),
  ('UNUSUAL_CORRIDOR',
   'Unusual or high-risk corridor',
   'Transfer routed through a corridor the sender has never used before, or a corridor on the high-risk list.',
   'medium',
   '{"lookback_days": 180, "high_risk_corridors": ["USD/IRR", "USD/KPW", "USD/SYP"]}'::jsonb),
  ('ROUND_AMOUNT_REPETITION',
   'Repeated round-figure transfers',
   'Multiple identical round-figure transfers by the same sender in a short window — a common layering pattern.',
   'low',
   '{"lookback_hours": 72, "min_count": 3, "round_to": 1000}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- ─── Seed: travel-rule thresholds ──────────────────────────────────────────

INSERT INTO travel_rule_thresholds (jurisdiction, threshold_usd, regulation) VALUES
  ('US', 3000.00, '31 CFR 1010.410(e) — Funds Transfer / Travel Rule'),
  ('EU',    0.00, 'Regulation (EU) 2023/1113 — no de minimis for CASP transfers'),
  ('GB', 1000.00, 'MLR 2017 Part 7A (as amended) — crypto transfer information'),
  ('SG', 1000.00, 'MAS PSN02 — Value Transfer requirements'),
  ('PH',  500.00, 'BSP Circular 1108 — VASP travel rule'),
  ('DEFAULT', 1000.00, 'FATF Recommendation 16 — USD/EUR 1000 threshold')
ON CONFLICT (jurisdiction) DO NOTHING;

-- ─── Seed: retention schedule ──────────────────────────────────────────────

INSERT INTO data_retention_policies (entity, retention_days, legal_basis, action) VALUES
  ('sanctions_screening_results', 1826, '5 years after the screening run — FATF R.11 / 31 CFR 1010.430', 'delete'),
  ('aml_alerts',                  1826, '5 years after disposition — FATF R.11 recordkeeping', 'delete'),
  ('sar_reports',                 1826, '5 years after filing — 31 CFR 1010.306(a)(2) / EU AMLD Art. 40', 'delete'),
  ('travel_rule_transfers',       1826, '5 years after the transfer — FATF R.16 / MLR 2017 reg. 40', 'delete'),
  ('compliance_report_audit',      730, '2 years — internal access-audit retention', 'delete'),
  ('user_kyc_status',             1826, '5 years after the business relationship ends — FATF R.11', 'anonymize')
ON CONFLICT (entity) DO NOTHING;
