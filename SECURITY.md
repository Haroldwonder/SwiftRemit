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

## Audit logging for security-sensitive operations (#1568)

Per the Security Checklist in `SETUP_GUIDE.md`, every admin and security-sensitive
operation must emit a structured audit record. Audit records are emitted as Soroban
contract events so they are captured by the indexer and retained off-chain.

### Audit record schema

Each audit event carries the following fields:

| Field | Description |
|-------|-------------|
| `actor` | Address that initiated the operation (the authenticated caller) |
| `action` | Stable action identifier (see table below) |
| `target` | Address, token, or config key affected by the operation |
| `timestamp` | Ledger timestamp at which the operation executed |
| `outcome` | `success` or `failure` (with error code when applicable) |

### Audited operations

| Action | Trigger | Actor | Target |
|--------|---------|-------|--------|
| `admin.add` | `add_admin` | Admin | New admin address |
| `admin.remove` | `remove_admin` | Admin | Removed admin address |
| `agent.register` | `register_agent` | Admin | Agent address |
| `agent.remove` | `remove_agent` | Admin | Agent address |
| `role.assign` | `assign_role` | Role admin | Target address |
| `role.remove` | `remove_role` | Role admin | Target address |
| `config.fee.update` | `update_fee`, `update_protocol_fee`, `update_fee_strategy` | Admin | Fee config key |
| `config.treasury.update` | `update_treasury` | Admin | Treasury address |
| `config.limit.update` | `set_daily_limit`, `update_rate_limit`, `update_rate_limit_config` | Admin | Limit config key |
| `config.whitelist.add` | `add_whitelisted_token` | Admin | Token address |
| `config.whitelist.remove` | `remove_whitelisted_token` | Admin | Token address |
| `config.asset_verification` | `set_asset_verification` | Admin | Token address |
| `circuit_breaker.pause` | `pause` | Admin | — |
| `circuit_breaker.unpause` | `unpause` | Admin | — |
| `fees.withdraw` | `withdraw_fees` | Admin | Destination address |
| `blacklist.add` | `blacklist_user` | Admin | Target address |
| `blacklist.remove` | `remove_from_blacklist` | Admin | Target address |
| `multisig.config` | `set_multisig_config` | Admin | — |
| `multisig.propose` | `propose_operation` | Admin | Operation id |
| `multisig.approve` | `approve_operation` | Admin | Operation id |
| `multisig.execute` | threshold reached | — | Operation id |
| `multisig.expire` | `expire_operation` | Any | Operation id |
| `migration.export` | `export_migration_snapshot` | Admin | — |
| `migration.import` | `import_migration_batch` | Admin | Batch id |

### Verification

- Audit events are emitted **after** authorization succeeds and **before** the
  state mutation is committed, so a failed authorization never produces a
  `success` record.
- Failed authorization attempts emit an audit record with `outcome = failure`
  and the corresponding error code.
- The multi-sig flow already emits `msig/proposed`, `msig/approved`,
  `msig/executed`, and `msig/expired` events; these are the canonical audit
  records for high-impact operations and must not be suppressed.
- Audit logging must remain enabled in all environments, including testnet and
  mainnet; it is not gated behind a feature flag.

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
| Audit logging | Structured audit events for all admin and security-sensitive operations (see above) |

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

See [docs/KEY_MANAGEMENT_POLICY.md](docs/KEY_MANAGEMENT_POLICY.md) for the admin key custody, rotation, and compromise response procedures (SR-111). All mainnet admin keys require h
