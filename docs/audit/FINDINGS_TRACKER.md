# SwiftRemit — External Audit Findings Tracker

> **Purpose:** Central triage register for all findings from the external security
> audit. Every finding must be assigned an owner, a severity, and a disposition
> before the audit window closes. No mainnet deployment proceeds until all Critical
> and High findings reach status `Remediated` and are confirmed by re-audit.
>
> Maintained by: Security Team  
> Audit window: TBD  
> Re-audit target: TBD  
> Last updated: 2026-07-30

---

## Severity Definitions

| Severity | Description | SLA |
|---|---|---|
| **Critical** | Direct loss of funds, complete auth bypass, or irreversible contract corruption | Remediate before re-audit; block mainnet |
| **High** | Significant financial risk, partial auth bypass, or exploitable data integrity issue | Remediate before re-audit; block mainnet |
| **Medium** | Meaningful risk that requires specific conditions to exploit | Remediate or formally accept with sign-off |
| **Low** | Minor issue with limited or theoretical impact | Remediate in next sprint or formally accept |
| **Informational** | Best-practice deviation, code quality, or documentation issue | Fix at discretion |

---

## Status Values

| Status | Meaning |
|---|---|
| `Open` | Finding received, not yet started |
| `In Progress` | Remediation actively underway |
| `Remediated` | Fix merged and verified locally |
| `Re-audited` | Auditor confirmed fix is effective |
| `Accepted` | Risk accepted with documented rationale and sign-off |
| `Duplicate` | Same root cause as another finding |
| `Invalid` | Not a valid finding (with explanation) |

---

## Findings Register

> **Instructions for auditor:** Add one row per finding. Use the ID format
> `SR-109-NNN` (e.g. `SR-109-001` for the first finding). Each row must include
> the exact function name(s) affected.

| ID | Severity | Title | Function(s) Affected | File(s) | Owner | Status | Remediation PR | Re-audit Result | Notes |
|---|---|---|---|---|---|---|---|---|---|
| SR-109-001 | High | `batch_settle_with_netting` missing `require_auth` | `batch_settle_with_netting` | `src/lib.rs`, `src/netting.rs` | TBD | Open | — | — | Pre-disclosed in KNOWN_ISSUES.md KI-001 |
| SR-109-002 | Medium | `execute_transaction` implicit auth only | `execute_transaction` | `src/lib.rs`, `src/transaction_controller.rs` | TBD | Open | — | — | Pre-disclosed in KNOWN_ISSUES.md KI-004 |
| SR-109-003 | Medium | Legacy `pause`/`unpause` bypasses governance timelock | `pause`, `unpause` | `src/lib.rs`, `src/circuit_breaker.rs` | TBD | Open | — | — | Pre-disclosed in KNOWN_ISSUES.md KI-006 |
| SR-109-004 | Medium | `migrate_to_governance` irreversible — no pre-validation | `migrate_to_governance` | `src/lib.rs`, `src/governance.rs` | TBD | Open | — | — | Pre-disclosed in KNOWN_ISSUES.md KI-007 |
| SR-109-005 | Medium | `batch_create_remittances` total amount relies on caller entries | `batch_create_remittances`, `create_batch_remittance` | `src/lib.rs` | TBD | Open | — | — | Pre-disclosed in KNOWN_ISSUES.md KI-010 |

---

## Pre-Disclosed Known Issues (from KNOWN_ISSUES.md)

These items are pre-disclosed to the auditor. The auditor should confirm severity
and may escalate.

| KI ID | Pre-disclosed Severity | Title | Audit Assessment | Escalated? |
|---|---|---|---|---|
| KI-001 | High | `batch_settle_with_netting` no `require_auth` | Pending | — |
| KI-002 | Low | `mark_failed` sets `Cancelled` not `Failed` | Pending | — |
| KI-003 | Info | Error code 70 absent from enum | Pending | — |
| KI-004 | Medium | `execute_transaction` implicit auth | Pending | — |
| KI-005 | Low | `process_expired_remittances` permissionless | Pending | — |
| KI-006 | Medium | Legacy `pause`/`unpause` bypasses timelock | Pending | — |
| KI-007 | Medium | `migrate_to_governance` irreversible | Pending | — |
| KI-008 | Medium | `confirm_batch_payout` idempotency | Pending | — |
| KI-009 | Low | No rate limit on `raise_dispute` | Pending | — |
| KI-010 | Medium | Batch amount calculation trusts caller | Pending | — |
| KI-B001 | High | Sanctions screening stub | Pending | — |
| KI-B002 | High | Travel rule transmission stub | Pending | — |
| KI-B003 | High | SAR e-Filing stub | Pending | — |

---

## Accepted Risks Register

Findings and known issues that have been formally accepted as residual risk. All
acceptances require sign-off from the Security Lead and at least one admin keyholder.

| ID | Title | Accepted Severity | Rationale | Accepted By | Date | Review Date |
|---|---|---|---|---|---|---|
| — | No accepted risks yet | — | — | — | — | — |

---

## Re-audit Scope

Once all Critical and High findings are remediated, the following items must be
included in the re-audit:

1. All `Critical` findings — full re-audit of remediation.
2. All `High` findings — full re-audit of remediation.
3. Any `Medium` findings that were escalated to `High` by the auditor.
4. Pre-disclosed items KI-001, KI-004, KI-006 after remediation.
5. The `batch_settle_with_netting` netting flow end-to-end.
6. The governance migration path (`migrate_to_governance` → `propose` → `vote` → `execute`).

---

## Mainnet Deployment Gate

The following conditions must all be true before mainnet deployment proceeds:

- [ ] All `Critical` findings: status `Re-audited`
- [ ] All `High` findings: status `Re-audited`
- [ ] All `Medium` findings: status `Remediated`, `Re-audited`, or `Accepted` (with sign-off)
- [ ] Final audit report published and linked here
- [ ] Re-audit letter or report published and linked here
- [ ] Security Lead sign-off
- [ ] At least 2 admin keyholders sign-off

**Final audit report:** _Link TBD_  
**Re-audit report:** _Link TBD_  
**Security Lead sign-off:** _Pending_
