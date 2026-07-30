# SwiftRemit — Known Issues and Accepted Gaps

> **Audit use:** This document is pre-disclosure material for the external security
> auditor. It lists every issue already known to the development team so that the
> audit report can focus on net-new findings and avoid duplicate triage work.
>
> Last updated: 2026-07-30 | Version: 1.0 | Status: Pre-audit

---

## 1. Smart-Contract Known Issues

### KI-001 — `batch_settle_with_netting` has no `require_auth`

| Field | Value |
|---|---|
| **Severity** | High |
| **Function** | `batch_settle_with_netting` in `src/lib.rs` |
| **Status** | Accepted risk / documented |
| **Tracked** | README.md — Batch/Netting table |

**Description:** `batch_settle_with_netting` does not call `require_auth` on any
parameter. The function is blocked when the contract is paused, but any account can
invoke it while the contract is live. In theory a caller could craft a netting batch
that net-settles amounts in ways the parties did not directly authorise.

**Existing mitigations:**
- All entries in the netting batch must reference pre-existing remittance IDs owned by
  the submitting agent.
- The circuit breaker (pause) blocks the function under emergency conditions.
- Net settlement validation (`NetSettlementValidationFailed`, error 37) is run before
  any token transfer occurs.

**Residual risk:** A registered agent could submit a netting batch referencing another
agent's remittances if those IDs are public (which they are). The economic damage is
limited because only remittances already in escrow can be included, but the ordering
of settlement could be manipulated.

**Recommended fix:** Add `require_auth` on the agent address and verify each entry
belongs to the calling agent before settlement.

---

### KI-002 — `mark_failed` sets status to `Cancelled`, not `Failed`

| Field | Value |
|---|---|
| **Severity** | Low (naming / documentation) |
| **Function** | `mark_failed` in `src/lib.rs` |
| **Status** | Known inconsistency, low security impact |
| **Tracked** | README.md — Contract Functions note |

**Description:** Despite its name, `mark_failed` transitions the remittance to
`Cancelled` and refunds the escrow to the sender. There is no separate code path that
sets the `Failed` status via this function. The `Failed` status is set internally
during processing failures.

**Risk:** Off-chain tooling or auditors may expect `mark_failed` to produce a `Failed`
status. Monitoring systems keyed on the status value may miss the refund event if they
only watch for `Cancelled`.

---

### KI-003 — Error code 70 is absent from `ContractError` enum

| Field | Value |
|---|---|
| **Severity** | Informational |
| **Location** | `src/errors.rs` |
| **Status** | Known gap in numbering sequence |

**Description:** The `ContractError` enum is sequenced 1–69 and then jumps to 71 and
83. Code 70 (`AgentAlreadyRegistered` is code 69; next is `NotDisputed` at 71) is
missing. This creates ambiguity if error codes are referenced numerically by
off-chain tooling.

**Risk:** Minimal. A client that maps numeric codes to messages may silently fail for
code 70 rather than surfacing the correct name.

---

### KI-004 — `execute_transaction` has no explicit `require_auth`

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Function** | `execute_transaction` in `src/lib.rs` |
| **Status** | Implicit auth only |
| **Tracked** | README.md — Transaction Controller table |

**Description:** `execute_transaction` does not call `require_auth` directly. Auth is
enforced implicitly because the function internally calls `create_remittance`, which
calls the USDC token's `transfer`, which requires the `user` address to have
authorised the transfer. If the token contract is non-standard, this implicit
guarantee may not hold.

**Existing mitigations:**
- Token whitelist (`add_whitelisted_token`) restricts which tokens can be used.
- USDC (Circle) enforces `require_auth` on transfers.

**Recommended fix:** Add an explicit `user.require_auth()` call at the top of
`execute_transaction` as a defence-in-depth measure regardless of the token used.

---

### KI-005 — `process_expired_remittances` is permissionless

| Field | Value |
|---|---|
| **Severity** | Low |
| **Function** | `process_expired_remittances`, `process_expired_escrows` |
| **Status** | Intentional design, documented |
| **Tracked** | README.md |

**Description:** These functions can be called by any account with a list of
remittance IDs. They only act on records that are both Pending and past their expiry
timestamp, so the worst an attacker can do is trigger a legitimate refund slightly
earlier than a keeper job would. No funds can be stolen.

**Residual risk:** An attacker who can observe the mempool could front-run a sender's
`cancel_remittance` by submitting `process_expired_remittances` first, resulting in
the same economic outcome (refund) but via a different code path, which may affect
off-chain monitoring logic.

---

### KI-006 — Single-step `pause` / `unpause` bypasses governance timelock

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Functions** | `pause()`, `unpause()` legacy wrappers |
| **Status** | Documented legacy path, superseded by `emergency_pause` / `vote_unpause` |

**Description:** The legacy `pause()` and `unpause()` functions execute immediately
on a single admin signature, bypassing the multisig threshold and timelock configured
via `set_pause_timelock` / `set_unpause_quorum`. An attacker with a single compromised
admin key can pause the contract without triggering the multisig flow.

**Existing mitigations:**
- The preferred path is `emergency_pause` + `vote_unpause` (requires quorum).
- Multiple admins + M-of-N multisig reduces key compromise probability.

**Recommended fix:** Deprecate or remove the legacy `pause` / `unpause` wrappers and
route all pause operations through the `emergency_pause` / `vote_unpause` flow.

---

### KI-007 — `migrate_to_governance` is a one-time, irreversible operation

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Function** | `migrate_to_governance` |
| **Status** | By design, but high-consequence |

**Description:** Once `migrate_to_governance` is called by the legacy single admin,
the governance quorum and timelock become active and the operation cannot be undone.
If called with an incorrect quorum or timelock, the contract governance may be
unrecoverably misconfigured.

**Recommended control:** Require the call to be previewed on testnet and approved via
a multi-sig proposal before executing on mainnet.

---

### KI-008 — `confirm_batch_payout` lacks individual idempotency checks

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Function** | `confirm_batch_payout` |
| **Status** | Open |

**Description:** `confirm_batch_payout` calls `confirm_payout` in a loop. If the
settlement hash check prevents double-payout for individual items, but if the batch
itself can be replayed (e.g., same remittance IDs in two separate batch calls), the
deduplication relies entirely on the per-remittance settlement hash. This should be
confirmed during audit.

---

### KI-009 — No rate limit on `raise_dispute`

| Field | Value |
|---|---|
| **Severity** | Low |
| **Function** | `raise_dispute` |
| **Status** | Open — potential DoS vector |

**Description:** A sender can call `raise_dispute` repeatedly on eligible remittances
without a per-sender cooldown. While the contract validates that the remittance is in
`Failed` status and within the dispute window, a sender with many failed remittances
could flood the dispute queue with minimal cost.

---

### KI-010 — `batch_create_remittances` total amount calculation trusts caller-supplied entries

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Function** | `batch_create_remittances` |
| **Status** | Open — requires audit confirmation |

**Description:** The function sums `entry.amount` values to compute the total token
transfer. If the individual amounts are manipulated (e.g., using overflow conditions
or the loop exits early), the single aggregate transfer may not match the sum of
individual escrow deposits. The Soroban SDK's overflow protection (`Overflow` error
36) should catch this, but the exact behaviour under boundary conditions should be
verified.

---

## 2. Off-Chain / Backend Known Issues

### KI-B001 — Sanctions screening uses stub provider by default

| Field | Value |
|---|---|
| **Severity** | High (operational gap) |
| **Location** | `backend/src/aml/sanctions-screening.ts` |
| **Status** | Stub must be replaced before mainnet |

**Description:** `SANCTIONS_PROVIDER=stub` returns no hits for any input. This is
intentional for development but must be replaced with a real OFAC/UN SDN list
integration before mainnet. The service throws if `NODE_ENV=production` and no real
provider is configured.

---

### KI-B002 — Travel rule transmission is stubbed

| Field | Value |
|---|---|
| **Severity** | High (regulatory gap) |
| **Location** | `backend/src/aml/travel-rule.ts` |
| **Status** | Stub must be replaced before mainnet |

**Description:** Travel rule data collection is implemented, but transmission to
counterparty VASPs is stubbed. A real VASP-to-VASP protocol (e.g., TRISA, OpenVASP,
or Notabene) must be integrated before live cross-border transfers above threshold.

---

### KI-B003 — SAR e-Filing is stubbed

| Field | Value |
|---|---|
| **Severity** | High (regulatory gap) |
| **Location** | `backend/src/aml/sar-workflow.ts` |
| **Status** | Stub must be replaced before operating in USA |

**Description:** The SAR workflow creates, reviews, and tracks SARs correctly, but
the final submission to FinCEN BSA E-Filing is stubbed. A licensed MSB must integrate
the actual FinCEN API before operating as a money services business in the USA.

---

## 3. Scope of Audit

The external auditor is expected to:

1. Confirm or escalate each item above as appropriate.
2. Identify any issues **not** listed here.
3. For each finding, provide: severity, function(s) affected, proof of concept (where
   safe to provide), and recommended remediation.
4. Re-audit all critical and high remediations.

Items already accepted as residual risk (KI-001 partial, KI-005, KI-007) should still
be reviewed — the auditor may reach a different severity conclusion and that
assessment governs.
