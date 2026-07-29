-- ============================================================================
-- Migration: Feature B (SEP-24 refund lifecycle) + Feature C (reconciler)
-- Created: 2026-07-29
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Feature B: SEP-24 refund attempt tracking
-- Records every failed cancel_remittance call per transaction.
-- Drives the MAX_REFUND_RETRIES idempotency guard in sep24-service.ts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sep24_refund_attempts (
    id              SERIAL PRIMARY KEY,
    transaction_id  VARCHAR(255) NOT NULL,
    attempt_number  INTEGER      NOT NULL,
    error_message   TEXT,
    attempted_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sep24_refund_attempts_txn
    ON sep24_refund_attempts (transaction_id);

-- ---------------------------------------------------------------------------
-- Feature B: Manual-review queue
-- Populated when all MAX_REFUND_RETRIES are exhausted.
-- Visible to admins; resolved manually and marked resolved_at.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sep24_manual_reviews (
    id              SERIAL       PRIMARY KEY,
    review_id       VARCHAR(64)  NOT NULL UNIQUE,
    transaction_id  VARCHAR(255) NOT NULL,
    anchor_id       VARCHAR(100),
    user_id         VARCHAR(255),
    asset_code      VARCHAR(12),
    refund_amount   VARCHAR(40),
    idempotency_key VARCHAR(255),
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
    reason          TEXT,
    created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMP,
    resolved_by     VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_sep24_manual_reviews_status
    ON sep24_manual_reviews (status);
CREATE INDEX IF NOT EXISTS idx_sep24_manual_reviews_txn
    ON sep24_manual_reviews (transaction_id);

-- ---------------------------------------------------------------------------
-- Feature B: User notification log
-- Audit trail for every localised notification sent during the refund lifecycle.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_notifications (
    id             SERIAL       PRIMARY KEY,
    user_id        VARCHAR(255) NOT NULL,
    transaction_id VARCHAR(255),
    event          VARCHAR(100) NOT NULL,
    locale         VARCHAR(10),
    subject        TEXT,
    body           TEXT,
    sent_at        TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user
    ON user_notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_txn
    ON user_notifications (transaction_id);

-- ---------------------------------------------------------------------------
-- Feature B: User profiles (locale preference)
-- Minimal table; only preferred_locale is required here.
-- Extend as needed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id          VARCHAR(255) PRIMARY KEY,
    preferred_locale VARCHAR(10)  NOT NULL DEFAULT 'en',
    created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Feature C: Reconciler run log
-- Optional persistent log of each reconciliation cycle — useful for ops dashboards.
-- The in-process Prometheus metrics (reconciler.ts) are the primary alerting path;
-- this table provides durable history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reconciler_runs (
    id                          SERIAL    PRIMARY KEY,
    run_at                      TIMESTAMP NOT NULL DEFAULT NOW(),
    duration_ms                 INTEGER,
    divergences_found           INTEGER   NOT NULL DEFAULT 0,
    divergences_repaired        INTEGER   NOT NULL DEFAULT 0,
    ledger_gaps_detected        INTEGER   NOT NULL DEFAULT 0,
    ledger_gaps_backfilled      INTEGER   NOT NULL DEFAULT 0,
    consecutive_divergent_cycles INTEGER  NOT NULL DEFAULT 0,
    error_message               TEXT
);

CREATE INDEX IF NOT EXISTS idx_reconciler_runs_run_at
    ON reconciler_runs (run_at DESC);
