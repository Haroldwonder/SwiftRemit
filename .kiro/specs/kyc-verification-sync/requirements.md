# Requirements Document

## Introduction

The KYC Verification Sync Service extends SwiftRemit's backend to actively poll anchor KYC status endpoints, maintain a dedicated per-user KYC status store, expose that status to the frontend, and enforce KYC approval as a hard gate before any transfer is initiated at the backend API layer. The service complements the existing webhook-based KYC updates and the on-chain KYC guard in the Soroban smart contract, closing the gap where a user's KYC state may change between webhook events.

## Glossary

- **KYC_Poller**: The background service that periodically queries anchor KYC status endpoints and writes results to the database.
- **KYC_Store**: The `user_kyc_status` database table that holds the canonical per-user KYC state.
- **Transfer_Guard**: The backend middleware that rejects transfer requests when a user's KYC status is not `approved`.
- **KYC_API**: The REST endpoints that expose user KYC status to the frontend.
- **Anchor**: An external financial institution registered in the `anchors` table that performs identity verification.
- **Anchor_Client**: The HTTP client component that calls an anchor's KYC status endpoint using token-based authentication.
- **KYC_Status**: One of three values: `pending`, `approved`, or `rejected`.
- **User**: A SwiftRemit account identified by a unique `user_id`.
- **Scheduler**: The existing `node-cron`-based background job runner in `backend/src/scheduler.ts`.

---

## Requirements

### Requirement 1: User KYC Status Persistence

**User Story:** As a backend engineer, I want a dedicated table that stores the latest KYC status per user per anchor, so that the system has a single source of truth for KYC state that is independent of transaction records.

#### Acceptance Criteria

1. THE KYC_Store SHALL contain one row per (user_id, anchor_id) pair representing the most recent KYC status for that combination.
2. THE KYC_Store SHALL record the fields: `user_id`, `anchor_id`, `kyc_status` (`pending` | `approved` | `rejected`), `kyc_level` (`basic` | `intermediate` | `advanced`), `rejection_reason`, `verified_at`, `expires_at`, `created_at`, and `updated_at`.
3. WHEN a KYC status update is written, THE KYC_Store SHALL update the existing row for that (user_id, anchor_id) pair rather than inserting a duplicate.
4. THE KYC_Store SHALL index rows by `user_id` and by `kyc_status` to support efficient lookup during transfer validation.

---

### Requirement 2: Anchor KYC Polling

**User Story:** As a compliance officer, I want the system to periodically poll each anchor's KYC status endpoint, so that user verification state stays current even when webhooks are delayed or missed.

#### Acceptance Criteria

1. WHEN the Scheduler triggers a KYC poll cycle, THE KYC_Poller SHALL query the KYC status endpoint for every enabled anchor in the `anchors` table.
2. THE KYC_Poller SHALL run on a configurable interval, defaulting to every 6 hours, matching the existing asset revalidation cadence.
3. WHEN polling an anchor, THE Anchor_Client SHALL authenticate using the token-based scheme defined by that anchor's configuration, supplying the `x-signature`, `x-timestamp`, `x-nonce`, and `x-anchor-id` headers.
4. WHEN an anchor returns a KYC status response, THE KYC_Poller SHALL upsert the result into the KYC_Store for the corresponding user.
5. IF an anchor endpoint returns an HTTP error or times out, THEN THE KYC_Poller SHALL log the error with the anchor ID and continue polling the remaining anchors without aborting the cycle.
6. THE KYC_Poller SHALL apply a configurable per-request delay between anchor calls to avoid rate-limit violations, defaulting to 1 second.
7. WHEN a poll cycle completes, THE KYC_Poller SHALL log the total number of users updated and the number of errors encountered.

---

### Requirement 3: Multi-Anchor Support

**User Story:** As a product manager, I want the KYC sync service to handle multiple anchors independently, so that a user's KYC status from each anchor is tracked separately and the strictest requirement governs transfer eligibility.

#### Acceptance Criteria

1. THE KYC_Poller SHALL process each enabled anchor independently, so that a failure for one anchor does not affect polling for other anchors.
2. WHEN a user has KYC records from multiple anchors, THE Transfer_Guard SHALL require that at least one anchor record has `kyc_status = approved` before permitting a transfer.
3. THE KYC_Store SHALL store one row per (user_id, anchor_id) pair, preserving the distinct KYC outcome from each anchor.
4. WHERE an anchor is disabled in the `anchors` table, THE KYC_Poller SHALL skip that anchor during the poll cycle.

---

### Requirement 4: Transfer Guard

**User Story:** As a compliance officer, I want the backend API to block transfer requests from users whose KYC is not approved, so that regulatory requirements are enforced before any funds move.

#### Acceptance Criteria

1. WHEN a transfer request is received, THE Transfer_Guard SHALL query the KYC_Store for the requesting user before forwarding the request to the smart contract.
2. IF the KYC_Store contains no `approved` record for the requesting user, THEN THE Transfer_Guard SHALL return HTTP 403 with a structured error body containing `code: "KYC_NOT_APPROVED"` and a human-readable `message`.
3. IF a user's KYC record has an `expires_at` timestamp that is earlier than the current time, THEN THE Transfer_Guard SHALL treat that record as not approved and return HTTP 403 with `code: "KYC_EXPIRED"`.
4. WHILE a user's KYC status is `pending`, THE Transfer_Guard SHALL reject transfer requests with HTTP 403 and `code: "KYC_PENDING"`.
5. THE Transfer_Guard SHALL enforce the KYC check independently of the on-chain `confirm_kyc` guard, providing a defence-in-depth layer at the API boundary.

---

### Requirement 5: KYC Status API

**User Story:** As a frontend developer, I want a REST endpoint that returns the current KYC status for the authenticated user, so that the UI can display accurate verification state and gate the transfer flow accordingly.

#### Acceptance Criteria

1. THE KYC_API SHALL expose a `GET /api/kyc/status` endpoint that returns the KYC status for the authenticated user.
2. WHEN the endpoint is called, THE KYC_API SHALL return a JSON response containing: `overall_status` (the most favourable status across all anchors), `anchors` (an array of per-anchor KYC records), and `can_transfer` (boolean).
3. IF no KYC record exists for the user, THEN THE KYC_API SHALL return `overall_status: "pending"` and `can_transfer: false`.
4. THE KYC_API SHALL require a valid authentication token; IF the token is absent or invalid, THEN THE KYC_API SHALL return HTTP 401.
5. THE KYC_API SHALL return HTTP 200 with the status payload for all authenticated requests, including users with `rejected` or `pending` status.

---

### Requirement 6: Webhook and Poll Consistency

**User Story:** As a backend engineer, I want KYC updates from webhooks and from polling to write to the same KYC_Store, so that the frontend always reads a consistent, unified state regardless of how the update arrived.

#### Acceptance Criteria

1. WHEN the existing `handleKYCUpdate` webhook handler processes a `kyc_update` event, THE KYC_Store SHALL be updated in addition to the existing `transactions.kyc_status` column.
2. THE KYC_Poller and the webhook handler SHALL use the same upsert logic when writing to the KYC_Store, so that the most recent update always wins regardless of source.
3. WHEN both a webhook and a poll update arrive for the same (user_id, anchor_id) pair, THE KYC_Store SHALL retain the record with the later `verified_at` timestamp.

---

### Requirement 7: Smart Contract KYC Synchronisation

**User Story:** As a backend engineer, I want the KYC sync service to propagate approved KYC status to the Soroban smart contract, so that on-chain transfer guards reflect the same state as the backend.

#### Acceptance Criteria

1. WHEN a user's KYC status transitions to `approved` in the KYC_Store, THE KYC_Poller SHALL call the smart contract's `set_kyc_approved` function with the user's Stellar address and the appropriate expiry timestamp.
2. WHEN a user's KYC status transitions to `rejected` in the KYC_Store, THE KYC_Poller SHALL call the smart contract's `set_kyc_approved` function with `approved = false` to revoke on-chain approval.
3. IF the smart contract call fails, THEN THE KYC_Poller SHALL log the error with the user address and continue processing remaining updates without rolling back the KYC_Store write.

---

### Requirement 8: Frontend KYC Status Display

**User Story:** As a user, I want the SwiftRemit UI to show my real KYC verification status, so that I know whether I am cleared to send money before attempting a transfer.

#### Acceptance Criteria

1. THE KYC_API SHALL provide sufficient data for the frontend to display one of three states: `pending`, `approved`, or `rejected`, with a per-anchor breakdown.
2. WHEN `can_transfer` is `false`, THE KYC_API response SHALL include a `reason` field with one of the values: `"no_kyc_record"`, `"kyc_pending"`, `"kyc_rejected"`, or `"kyc_expired"`.
3. THE KYC_API SHALL include a `last_checked` timestamp in the response so the frontend can indicate how recently the status was verified.

---

### Requirement 9: KYC Status Round-Trip Integrity

**User Story:** As a backend engineer, I want to verify that a KYC status written to the KYC_Store can be read back with identical values, so that serialisation and persistence do not silently corrupt data.

#### Acceptance Criteria

1. FOR ALL valid KYC status records written to the KYC_Store, THE KYC_Store SHALL return an equivalent record when queried by the same (user_id, anchor_id) key (round-trip property).
2. WHEN a KYC status record is serialised to JSON for the KYC_API response and then deserialised, THE KYC_API SHALL produce a record equivalent to the original (round-trip property).
3. THE KYC_Store SHALL preserve the `kyc_status` enum value exactly; IF an unrecognised status value is received from an anchor, THEN THE KYC_Poller SHALL reject the record and log a warning without writing to the KYC_Store.
