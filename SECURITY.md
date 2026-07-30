# SwiftRemit Security Model

This document describes the authorization model for the SwiftRemit Soroban smart contract
and records the findings of the security audit conducted against issue #937.

---

## External Security Audit (SR-109)

An external security audit of the smart contract is required before mainnet deployment.
**No mainnet deploy proceeds until the re-audit passes.**

| Document | Path |
|---|---|
| Audit scope | [`docs/audit/AUDIT_SCOPE.md`](docs/audit/AUDIT_SCOPE.md) |
| Contract architecture | [`docs/audit/ARCHITECTURE.md`](docs/audit/ARCHITECTURE.md) |
| Known issues (pre-disclosure) | [`docs/audit/KNOWN_ISSUES.md`](docs/audit/KNOWN_ISSUES.md) |
| Findings tracker | [`docs/audit/FINDINGS_TRACKER.md`](docs/audit/FINDINGS_TRACKER.md) |
| Pre-engagement checklist | [`docs/audit/AUDIT_CHECKLIST.md`](docs/audit/AUDIT_CHECKLIST.md) |

The audit freeze CI workflow (`.github/workflows/audit-freeze.yml`) blocks new
`pub fn` additions to `src/lib.rs` without auditor agreement during the audit window.

---

## Threat Model (SR-110)

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for the full STRIDE threat model
covering all system trust boundaries, adversary profiles, and residual risks.
The threat model is reviewed at every release.

---

## Roles

| Role | Description |
|------|-------------|
| **Admin** | Can mutate global contract configuration, manage agents and admins, withdraw fees, pause/unpause, and configure limits. Multiple admins are supported via the `add_admin` / `remove_admin` functions. At least one admin must always remain. |
| **Settler** | Registered agent authorized to confirm (settle) remittance payouts. Granted automatically when an admin calls `register_agent`. |
| **Sender** | Any address that calls `create_remittance`; authenticated via `require_auth` on their own address. |

---

## Authorization audit — `#[contractimpl]` functions

Every state-mutating function is listed below with its authorization mechanism.
Read-only (`get_*`, `is_*`, `has_*`) functions that never mutate state require no
caller authentication and are omitted.

### Admin-gated functions (require `require_admin`)

| Function | Auth mechanism | Notes |
|----------|---------------|-------|
| `register_agent` | `get_admin()? + require_admin()` | |
| `remove_agent` | `get_admin()? + require_admin()` | |
| `update_fee` | `get_admin()? + require_admin()` | |
| `withdraw_fees` | `get_admin()? + require_admin()` | |
| `pause` | `get_admin()? + require_admin()` | |
| `unpause` | `get_admin()? + require_admin()` | |
| `add_admin` | `require_admin(&env, &caller)` | caller supplied explicitly |
| `remove_admin` | `require_admin(&env, &caller)` | caller supplied explicitly |
| `add_whitelisted_token` | `get_admin()? + require_admin()` | |
| `remove_whitelisted_token` | `get_admin()? + require_admin()` | |
| `update_rate_limit` | `get_admin()? + admin.require_auth()` | |
| `set_daily_limit` | `get_admin()? + admin.require_auth()` | |
| `update_rate_limit_config` | `require_admin(&env, &caller)` | |
| `update_fee_strategy` | `require_admin(&env, &caller)` | |
| `update_protocol_fee` | `require_admin(&env, &caller)` | |
| `update_treasury` | `require_admin(&env, &caller)` | |
| `set_asset_verification` | `get_admin()? + admin.require_auth()` | |
| `set_fee_corridor` | see impl | delegated to fee_service module |
| `remove_fee_corridor` | see impl | delegated to fee_service module |
| `assign_role` | `caller.require_auth() + require_role_admin()` | |
| `remove_role` | `caller.require_auth() + require_role_admin()` | |
| `set_multisig_config` | `require_admin(&env, &caller)` | new in #253 |
| `propose_operation` | `require_admin() + proposer.require_auth()` | new in #253 |
| `approve_operation` | `require_admin() + approver.require_auth()` | new in #253 |
| `export_migration_snapshot` | `require_admin(&env, &caller)` | |
| `import_migration_batch` | `require_admin(&env, &caller)` | |
| `blacklist_user` | delegates to `set_blacklist_status` → `require_admin` | |
| `remove_from_blacklist` | delegates to `set_blacklist_status` → `require_admin` | |

### Sender-gated functions (require `sender.require_auth()`)

| Function | Auth mechanism | Notes |
|----------|---------------|-------|
| `create_remittance` | `sender.require_auth()` | |
| `create_remittance_with_corridor` | `sender.require_auth()` | |
| `batch_create_remittances` | `sender.require_auth()` | |
| `cancel_remittance` | checks `remittance.sender == caller` | |
| `create_escrow` | `sender.require_auth()` | |
| `withdraw_integrator_fees` | `integrator.require_auth()` | integrator only |

### Agent-gated functions (require registered agent)

| Function | Auth mechanism | Notes |
|----------|---------------|-------|
| `confirm_payout` | checks `is_agent_registered` + `agent.require_auth()` | |
| `finalize_remittance` | checks caller is agent or admin | |
| `mark_failed` | checks `is_agent_registered` | |
| `batch_settle_with_netting` | checks `is_agent_registered` | |

### Circuit-breaker / public functions (no auth required)

| Function | Notes |
|----------|-------|
| `expire_operation` | Anyone can sweep expired pending operations — no harm in public access |
| `process_expired_remittances` | Permissionless; only refunds expire-eligible records |
| All `get_*` / `is_*` / `has_*` | Read-only; no state mutation |
| `health` | Diagnostic only |

---

## Multi-signature protection for high-impact operations (#253)

The following operations go through the M-of-N multi-sig flow rather than executing
immediately on a single admin signature:

| Operation | `AdminOperationType` variant |
|-----------|------------------------------|
| Platform fee changes | `UpdateFee` |
| Fee withdrawal to external address | `WithdrawFees` |
| Emergency pause | `Pause` |
| Unpause | `Unpause` |

**Flow:**
1. Any admin calls `propose_operation` — creates a `PendingOperation`, emits `msig/proposed`, and auto-approves the proposer.
2. Additional admins call `approve_operation` — emits `msig/approved` per approval.
3. When `approvers.len() >= threshold`, the operation executes and emits `msig/executed`.
4. Operations that do not reach threshold within `ttl_seconds` expire; anyone can call `expire_operation` to emit `msig/expired` and clean up storage.

**Defaults:** threshold=1, TTL=86 400 s (24 h).  Configure with `set_multisig_config`.

---

## Defense-in-depth measures

| Measure | Where implemented |
|---------|-------------------|
| Re-entrancy: Soroban VM is single-threaded; no callbacks during execution | SDK guarantee |
| Duplicate settlement prevention | `SettlementData` / `SettlementPacked` storage keys |
| Blacklist | `UserBlacklisted` storage key checked in `create_remittance` |
| Daily send limits | `enforce_daily_send_limit` called in every remittance creation path |
| Rate limiting | `RateLimitConfig` applied per address |
| Circuit breaker | `pause` / `unpause` block all user-facing state mutations |
| Migration guard | `MigrationInProgress` flag blocks concurrent writes during data migration |
| Token whitelist | Only whitelisted tokens accepted for new remittances |
| Admin count guard | `CannotRemoveLastAdmin` error prevents admin lockout |

---

## AML/CTF Compliance

See [docs/COMPLIANCE_CONTROLS.md](docs/COMPLIANCE_CONTROLS.md) for the full compliance control inventory mapping regulatory obligations to implemented controls.

Key controls:
- Sanctions and PEP screening: `backend/src/aml/sanctions-screening.ts`
- Transaction monitoring (structuring, velocity): `backend/src/aml/transaction-monitoring.ts`
- SAR workflow: `backend/src/aml/sar-workflow.ts`
- Travel rule data collection: `backend/src/aml/travel-rule.ts`
- Data retention: `backend/src/aml/retention.ts`
- Review queue API: `backend/src/routes/aml.ts`

---

## Key Management

See [docs/KEY_MANAGEMENT_POLICY.md](docs/KEY_MANAGEMENT_POLICY.md) for the admin key custody, rotation, and compromise response procedures (SR-111). All mainnet admin keys require hardware wallet (Ledger/Trezor) or HSM custody. Private key material must never exist in plaintext on any server, CI/CD system, or cloud environment.

Key controls at a glance:

- **Custody:** Hardware wallet or HSM for all mainnet `Admin` and Treasury keys.
- **Rotation:** Quarterly minimum and before every mainnet upgrade. Rehearsal script: `scripts/rehearse-key-rotation.sh`.
- **Compromise response:** Target RTO 2 hours. Rehearsal script: `scripts/rehearse-compromise-response.sh`.
- **CI/CD keys:** Testnet-only scope; stored as GitHub Actions Secrets; rotated every 90 days and on team-member departure.
- **Multi-sig:** High-impact operations (`withdraw_fees`, `update_fee`, `add_admin`, WASM upgrade) require M ≥ 2 admin approvals.

---

## Reporting vulnerabilities

Please email **security@swiftremit.example** or open a GitHub Security Advisory.
Do not open public issues for potential security vulnerabilities.
