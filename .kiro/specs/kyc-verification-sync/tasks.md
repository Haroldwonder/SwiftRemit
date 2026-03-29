# Implementation Plan: KYC Verification Sync Service

## Overview

Implement a polling-based KYC status layer for SwiftRemit. The work proceeds in dependency order: schema → types → upsert service → anchor client → poller → webhook integration → transfer guard → API → smart contract sync → frontend component → property tests.

## Tasks

- [x] 1. Database migration — create KYC schema
  - Create `backend/migrations/kyc_status_schema.sql`
  - Add `user_kyc_status` table with `UNIQUE (user_id, anchor_id)` constraint, indexes on `user_id` and `kyc_status`, and all fields from the design (`id`, `user_id`, `anchor_id`, `kyc_status` CHECK, `kyc_level` CHECK, `rejection_reason`, `verified_at`, `expires_at`, `created_at`, `updated_at`)
  - Add `ALTER TABLE anchors ADD COLUMN IF NOT EXISTS kyc_endpoint VARCHAR(512)` (the `webhook_secret` column already exists per `webhook_schema.sql`)
  - _Requirements: 1.1, 1.2, 1.4_

- [x] 2. TypeScript types — extend `backend/src/types.ts`
  - [x] 2.1 Add KYC type definitions
    - Add `KycStatus`, `KycLevel`, `KycRecord`, `AnchorKycRecord`, and `UserKycStatus` type exports to `backend/src/types.ts`
    - Match the exact shapes defined in the design document
    - _Requirements: 1.2, 5.2, 8.1, 8.2, 8.3_

- [x] 3. Implement `KycUpsertService` (`backend/src/kyc-upsert-service.ts`)
  - [x] 3.1 Implement `upsert()` method
    - Validate `kyc_status` is one of `pending | approved | rejected`; throw `ValidationError` for any other value
    - Use `INSERT ... ON CONFLICT (user_id, anchor_id) DO UPDATE ... WHERE verified_at < EXCLUDED.verified_at` for last-write-wins semantics
    - _Requirements: 1.1, 1.3, 6.2, 6.3, 9.3_

  - [ ]* 3.2 Write property test for upsert uniqueness (Property 1)
    - **Property 1: Upsert uniqueness** — any sequence of writes for the same (user_id, anchor_id) pair results in exactly one row
    - **Validates: Requirements 1.1, 1.3, 3.3**

  - [ ]* 3.3 Write property test for KYC store round-trip (Property 2)
    - **Property 2: KYC store round-trip** — write then read by (user_id, anchor_id) produces identical field values
    - **Validates: Requirements 1.2, 9.1**

  - [ ]* 3.4 Write property test for invalid status rejection (Property 4)
    - **Property 4: Invalid status rejection** — any string not in `{pending, approved, rejected}` causes `upsert()` to throw without writing
    - **Validates: Requirements 9.3**

  - [ ]* 3.5 Write property test for last-write-wins (Property 14)
    - **Property 14: Last-write-wins on concurrent updates** — two records with different `verified_at` written in random order; the later timestamp is retained
    - **Validates: Requirements 6.3**

  - [x] 3.6 Implement `getStatusForUser()` method
    - Query all rows for `user_id`; derive `overall_status` (approved if any non-expired approved row exists), `can_transfer`, `reason`, and `last_checked`
    - _Requirements: 3.2, 5.2, 5.3, 8.1, 8.2, 8.3_

- [x] 4. Implement `AnchorKycClient` (`backend/src/anchor-kyc-client.ts`)
  - [x] 4.1 Implement `fetchKycStatuses()` with HMAC-SHA256 auth headers
    - Compute `x-signature` as HMAC-SHA256 over `timestamp + nonce + anchor_id` using the anchor's `webhook_secret`
    - Include all four required headers: `x-signature`, `x-timestamp`, `x-nonce`, `x-anchor-id`
    - Return parsed `KycRecord[]`
    - _Requirements: 2.3_

  - [ ]* 4.2 Write property test for auth headers presence (Property 6)
    - **Property 6: Anchor client sends required auth headers** — every outbound request includes all four headers
    - **Validates: Requirements 2.3**

- [x] 5. Implement `KycPoller` and integrate into scheduler
  - [x] 5.1 Implement `KycPoller.runCycle()` (`backend/src/kyc-poller.ts`)
    - Query `anchors` table for all rows where `enabled = true` and `kyc_endpoint IS NOT NULL`
    - For each anchor: instantiate `AnchorKycClient`, call `fetchKycStatuses()`, upsert each record via `KycUpsertService`
    - Wrap each anchor in its own try/catch; log `{ anchor_id, error }` on failure; increment error counter; continue
    - Apply configurable `delayMs` between anchors (default 1000 ms)
    - Log `{ updated, errors }` on cycle completion
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 3.1, 3.4_

  - [ ]* 5.2 Write property test for poller queries all enabled anchors (Property 5)
    - **Property 5: Poller queries all enabled anchors** — after one cycle, every enabled anchor is queried exactly once; disabled anchors are never queried
    - **Validates: Requirements 2.1, 3.4**

  - [ ]* 5.3 Write property test for anchor error isolation (Property 8)
    - **Property 8: Anchor error isolation** — when a random subset of anchors fail, all remaining enabled anchors are still polled
    - **Validates: Requirements 2.5, 3.1**

  - [ ]* 5.4 Write property test for poll result upserted to store (Property 7)
    - **Property 7: Poll result upserted to store** — after a cycle, the KYC_Store reflects the values returned by each anchor
    - **Validates: Requirements 2.4**

  - [x] 5.5 Register `KycPoller` in `backend/src/scheduler.ts`
    - Instantiate `KycPoller` with the shared `Pool` and `KycUpsertService` inside `startBackgroundJobs()`
    - Add a second `cron.schedule('0 */6 * * *', ...)` entry that calls `kycPoller.runCycle()`
    - _Requirements: 2.1, 2.2_

- [x] 6. Checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [-] 7. Update `WebhookHandler.handleKYCUpdate()` (`backend/src/webhook-handler.ts`)
  - [x] 7.1 Inject `KycUpsertService` into `WebhookHandler` constructor
    - Add `private kycUpsertService: KycUpsertService` parameter to the constructor
    - _Requirements: 6.1, 6.2_

  - [ ] 7.2 Call `KycUpsertService.upsert()` inside `handleKYCUpdate()`
    - After the existing `this.stateManager.updateKYCStatus(update)` call, derive `user_id` and `anchor_id` from the payload and call `this.kycUpsertService.upsert(record)`
    - Use the same `verified_at` timestamp for both writes
    - _Requirements: 6.1, 6.2_

  - [ ]* 7.3 Write property test for webhook updates both stores (Property 13)
    - **Property 13: Webhook updates both stores** — any `kyc_update` webhook payload causes both `transactions.kyc_status` and `user_kyc_status` to be updated
    - **Validates: Requirements 6.1**

- [ ] 8. Implement `TransferGuard` middleware (`backend/src/transfer-guard.ts`)
  - [ ] 8.1 Implement `createTransferGuard(upsertService)` factory
    - Extract `user_id` from `req.user` (set by existing auth middleware)
    - Call `upsertService.getStatusForUser(userId)`
    - If `can_transfer` is `true`, call `next()`
    - If `can_transfer` is `false`, return HTTP 403 with `{ error: { code, message } }` where `code` is one of `KYC_NOT_APPROVED`, `KYC_PENDING`, or `KYC_EXPIRED`
    - On DB error, return HTTP 500 and do not call `next()`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 8.2 Write property test for transfer guard at-least-one-approved rule (Property 9)
    - **Property 9: Transfer guard enforces at-least-one-approved rule** — guard permits iff KYC_Store has at least one non-expired `approved` record; otherwise returns 403
    - **Validates: Requirements 3.2, 4.1, 4.2, 4.3, 4.4**

  - [ ]* 8.3 Write property test for correct error codes (Property 10)
    - **Property 10: Transfer guard returns correct error codes** — 403 body `code` matches the actual rejection reason
    - **Validates: Requirements 4.2, 4.3, 4.4**

- [ ] 9. Add `GET /api/kyc/status` route (`backend/src/api.ts`)
  - [ ] 9.1 Register the KYC status endpoint
    - Add `app.get('/api/kyc/status', authMiddleware, async (req, res) => { ... })` in `backend/src/api.ts`
    - Call `kycUpsertService.getStatusForUser(req.user.id)` and return the result as HTTP 200 JSON
    - Unauthenticated requests are rejected by the existing auth middleware with HTTP 401
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 9.2 Write property test for KYC API response shape (Property 11)
    - **Property 11: KYC API response shape** — response always contains `overall_status`, `can_transfer`, `anchors`, `last_checked`; when `can_transfer` is false, `reason` is also present
    - **Validates: Requirements 5.2, 8.1, 8.2, 8.3**

  - [ ]* 9.3 Write property test for KYC API returns HTTP 200 (Property 12)
    - **Property 12: KYC API returns HTTP 200** — all authenticated requests return 200 regardless of KYC status
    - **Validates: Requirements 5.5**

  - [ ]* 9.4 Write property test for JSON serialisation round-trip (Property 3)
    - **Property 3: JSON serialisation round-trip** — `JSON.stringify` then `JSON.parse` of any valid `KycRecord` produces an equivalent record with dates preserved as ISO-8601 strings
    - **Validates: Requirements 9.2**

- [ ] 10. Checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Smart contract sync — call `set_kyc_approved` on status transitions
  - [ ] 11.1 Add Soroban `set_kyc_approved` call in `KycUpsertService`
    - After a successful upsert, if the new `kyc_status` is `approved`, call `stellarClient.setKycApproved(userStellarAddress, true, expiresAt)`
    - If the new `kyc_status` is `rejected`, call `stellarClient.setKycApproved(userStellarAddress, false)`
    - Wrap the contract call in try/catch; log `{ user_address, error }` on failure; do NOT roll back the KYC_Store write
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 11.2 Write property test for KYC status transition triggers correct contract call (Property 15)
    - **Property 15: KYC status transition triggers correct contract call** — `approved` transition calls `set_kyc_approved(true)`; `rejected` transition calls `set_kyc_approved(false)`
    - **Validates: Requirements 7.1, 7.2**

  - [ ]* 11.3 Write property test for contract call failure isolation (Property 16)
    - **Property 16: Contract call failure does not roll back KYC_Store write** — when the contract call throws, the KYC_Store record is unchanged
    - **Validates: Requirements 7.3**

- [ ] 12. Frontend `KycStatusBadge` component (`frontend/src/components/KycStatusBadge.tsx`)
  - [ ] 12.1 Create `KycStatusBadge` React component
    - Fetch `GET /api/kyc/status` on mount; render one of three states: `pending`, `approved`, `rejected`
    - Show a per-anchor breakdown (anchor ID, status, `kyc_level`, `verified_at`, `expires_at`)
    - Show a `last_checked` timestamp
    - When `can_transfer` is `false`, display the `reason` value
    - Follow the same structural pattern as `VerificationBadge.tsx` (loading state, error state, modal for details)
    - _Requirements: 8.1, 8.2, 8.3_

- [ ] 13. Property-based test suite (`backend/src/__tests__/kyc-verification-sync.property.test.ts`)
  - [ ] 13.1 Create the property test file with fast-check
    - Import `fc` from `fast-check`; configure `{ numRuns: 100 }` for all assertions
    - Tag each test with `// Feature: kyc-verification-sync, Property N: <text>`
    - Implement all 16 property tests (P1–P16) as described in the design document's Testing Strategy section
    - Use in-memory stubs / mocks for DB and HTTP calls to keep tests fast and deterministic
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3, 2.4, 2.5, 3.2, 4.1, 4.2, 4.3, 4.4, 5.2, 5.5, 6.1, 6.3, 7.1, 7.2, 7.3, 9.1, 9.2, 9.3_

- [ ] 14. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests in task 13 consolidate all 16 properties; the `*` sub-tasks in earlier tasks are the per-component placement of those same properties for early error detection
- The `webhook_secret` column already exists in the `anchors` table (see `webhook_schema.sql`); only `kyc_endpoint` needs to be added in the migration
