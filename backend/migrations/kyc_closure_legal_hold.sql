-- SR-112 follow-up: anonymize approved KYC records once the AML/CTF legal
-- hold has lapsed after account closure.
--
-- ENTITY_PLANS.user_kyc_status (backend/src/aml/retention.ts) has always
-- excluded approved rows (`status <> 'approved'`) because that data is under
-- mandatory legal hold while the relationship is active. But there was never
-- a companion plan to anonymize those rows once the account closes and the
-- hold period (5 years — see RETENTION_POLICIES.AML_LEGAL_HOLD in
-- backend/src/privacy/retention-service.ts) elapses, so approved users' KYC
-- data persisted indefinitely. This adds the closure timestamp the new
-- `user_kyc_status_closed` entity plan keys off, plus its schedule row.

ALTER TABLE user_kyc_status ADD COLUMN IF NOT EXISTS account_closed_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_kyc_status_account_closed_at
  ON user_kyc_status(account_closed_at)
  WHERE account_closed_at IS NOT NULL;

INSERT INTO data_retention_policies (entity, retention_days, legal_basis, action) VALUES
  ('user_kyc_status_closed', 1825,
   '5 years after account closure — FATF R.11 / AML_LEGAL_HOLD (shared with privacy/retention-service.ts checkAmlLegalHold)',
   'anonymize')
ON CONFLICT (entity) DO NOTHING;
