# Fix: approved KYC records were never anonymized after account closure

## Problem

`ENTITY_PLANS.user_kyc_status` in `backend/src/aml/retention.ts` only ever
anonymized rows guarded by `status <> 'approved'`. Approved KYC records —
the ones actually subject to AML/CTF recordkeeping obligations — were
permanently excluded from both the delete and anonymize paths, with no
separate plan keyed on account-closure date.

Separately, `backend/src/privacy/retention-service.ts` modeled a 5-year
`AML_LEGAL_HOLD` concept (`checkAmlLegalHold()`, keyed off a
`lastActivityDate`) that `aml/retention.ts` never referenced. Two
independent implementations of the same retention concept existed, and
neither honored the other.

Net effect: once a user was KYC-approved, their `verification_data` /
`rejection_reason` / PII in `user_kyc_status` persisted indefinitely, with
no automated path to anonymize it even long after account closure and the
legal-hold period had passed.

## What was implemented

1. **New entity plan `user_kyc_status_closed`** (`backend/src/aml/retention.ts`)
   anonymizes approved `user_kyc_status` rows once `account_closed_at` is
   set and the legal-hold window has elapsed, using the same
   `anonymizeSet` as the existing plan.

2. **Shared hold-window calculation.** `RetentionService.cutoffFor()` now
   sources the retention window for both `user_kyc_status` and
   `user_kyc_status_closed` from
   `RETENTION_POLICIES.AML_LEGAL_HOLD.retentionDays` in
   `backend/src/privacy/retention-service.ts` — the same constant
   `checkAmlLegalHold()` uses — instead of trusting a possibly-drifted
   `data_retention_policies.retention_days` value for those two entities.

3. **New exported helper `isKycLegalHoldExpired(accountClosedAt)`**
   delegates directly to `checkAmlLegalHold()`, giving other callers
   (e.g. the GDPR erasure endpoint in `backend/src/routes/privacy.ts`) a
   single authoritative way to check the same hold window instead of
   re-deriving it.

4. **Schema/migration** (`backend/migrations/kyc_closure_legal_hold.sql`,
   mirrored in `backend/src/database.ts`'s bootstrap schema): adds
   `user_kyc_status.account_closed_at` (the timestamp the new plan's
   cutoff is keyed on) plus an index, and seeds the
   `user_kyc_status_closed` row into `data_retention_policies` (1825
   days / 5 years, `anonymize`).

## Out of scope / follow-ups

- Nothing in the codebase currently writes `account_closed_at` on account
  closure (the GDPR erasure endpoint in `routes/privacy.ts` operates on an
  in-memory mock store, not this table). Wiring the real account-closure
  event to populate this column is a separate change.
- `checkAmlLegalHold()` still has no caller that acts on its result inside
  `routes/privacy.ts` itself — flagged in the related GDPR privacy-API
  issue as a separate item.
