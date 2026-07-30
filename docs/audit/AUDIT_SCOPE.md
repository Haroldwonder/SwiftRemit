# SR-109 Security Audit — Scope Document

**Engagement reference:** SR-109  
**Document version:** 1.0  
**Date:** 2026-07-30  
**Prepared by:** SwiftRemit Engineering  
**Status:** DRAFT — pending auditor sign-off

---

## 1. Contract Metadata

| Field | Value |
|---|---|
| Package name | `swiftremit` |
| Contract version | `0.1.0` (see [`Cargo.toml`](../../Cargo.toml)) |
| `soroban-sdk` version | `26.1.0` (pinned in `Cargo.toml`) |
| Rust toolchain | `stable` (pinned via [`rust-toolchain.toml`](../../rust-toolchain.toml)) |
| Audit commit hash | `<!-- FILL IN: git rev-parse HEAD at time of audit -->` |
| Audit branch | `<!-- FILL IN: e.g. sr-109-audit-freeze -->` |
| Target network | Stellar Testnet (pre-mainnet) |
| WASM target | `wasm32-unknown-unknown` |

> **Note:** The commit hash must be recorded by the auditor immediately after checkout and referenced in all findings. The contract must not be modified after audit commencement without opening a new scope-change ticket.

---

## 2. Repository Structure (Audit-Relevant Paths)

```
SwiftRemit/
├── src/                          ← PRIMARY AUDIT TARGET
│   ├── lib.rs                    ← Main contract entrypoint (all public functions)
│   ├── types.rs                  ← RemittanceStatus, Remittance, Role enums/structs
│   ├── errors.rs                 ← ContractError enum (codes 1–83, with gap at 70–82)
│   ├── events.rs                 ← All event emission functions
│   ├── storage.rs                ← Persistent + instance storage layer
│   ├── transitions.rs            ← State machine validation
│   ├── fee_service.rs            ← Fee calculation, corridor logic
│   ├── fee_management.rs         ← Fee accumulation and withdrawal
│   ├── fee_strategy.rs           ← Fee strategy enum
│   ├── governance.rs             ← DAO governance: propose/vote/execute
│   ├── multisig.rs               ← M-of-N multisig for high-impact ops
│   ├── circuit_breaker.rs        ← Pause/unpause logic
│   ├── circuit_breaker_storage.rs← Circuit breaker storage helpers
│   ├── rate_limit.rs             ← Per-address rate limiting
│   ├── abuse_protection.rs       ← Abuse detection and blocking
│   ├── netting.rs                ← Batch netting settlement
│   ├── migration.rs              ← State export/import migration
│   ├── transaction_controller.rs ← Orchestrated transaction pipeline
│   ├── asset_verification.rs     ← On-chain asset trust metadata
│   ├── validation.rs             ← Input validation helpers
│   ├── hashing.rs                ← Settlement hash computation
│   ├── oracle.rs                 ← Oracle integration stubs
│   ├── recipient_verification.rs ← Recipient hash commitment
│   ├── verification.rs           ← KYC / blacklist helpers
│   ├── health.rs                 ← Health query function
│   ├── config.rs                 ← Contract configuration helpers
│   ├── response.rs               ← Response type wrappers
│   ├── error_handler.rs          ← Error normalization helpers
│   └── debug.rs                  ← Debug-only utilities (feature-gated)
├── Cargo.toml                    ← Dependency manifest (source of truth for deps)
├── rust-toolchain.toml           ← Toolchain pin
├── abi/swiftremit-v1.json        ← Published ABI (cross-reference with lib.rs)
└── fuzz/
    └── fuzz_targets/             ← Existing libFuzzer targets
```

---

## 3. In-Scope Functions

All `pub fn` entries in the `#[contractimpl] impl SwiftRemitContract` block in `src/lib.rs` are in scope. The full, authoritative list is maintained in [`README.md § Contract Functions`](../../README.md#contract-functions) (enforced by CI via `scripts/check_readme_functions.sh`).

### 3.1 Remittance Lifecycle

| Function | Primary Risk |
|---|---|
| `initialize` | One-time setup; replay / mis-initialization |
| `create_remittance` | Fund custody, validation bypass, limit enforcement |
| `create_remittance_with_corridor` | Fee corridor manipulation |
| `confirm_payout` | Double-settlement, unauthorized agent payout |
| `mark_failed` | Unauthorized status change, naming inconsistency (see Known Issues) |
| `cancel_remittance` | Unauthorized cancellation, refund correctness |
| `process_expired_remittances` | Batch DoS, incorrect expiry check |
| `raise_dispute` | Dispute window enforcement |
| `resolve_dispute` | Fund routing to sender vs. agent |
| `confirm_partial_payout` | Partial disbursement arithmetic, auto-complete logic |
| `finalize_remittance` | Authorization boundary |

### 3.2 Escrow

| Function | Primary Risk |
|---|---|
| `create_escrow` | Fund custody |
| `release_escrow` | Authorization check |
| `refund_escrow` | Sender identity check |
| `process_expired_escrows` | Batch DoS |
| `update_escrow_ttl` | Admin-only enforcement |

### 3.3 Batch and Netting

| Function | Primary Risk |
|---|---|
| `batch_create_remittances` | Total amount arithmetic, atomicity |
| `create_batch_remittance` | Same as above, plus event emission |
| `confirm_batch_payout` | Partial confirmation, loop invariants |
| `batch_settle_with_netting` | **No `require_auth`** — see Known Issues §2; netting arithmetic correctness |

### 3.4 Fee Management

| Function | Primary Risk |
|---|---|
| `update_fee` / `update_protocol_fee` | Admin-only, multisig path |
| `withdraw_fees` / `withdraw_integrator_fees` | Fund draining |
| `set_fee_corridor` / `remove_fee_corridor` | Admin-only |
| `fee_breakdown_corridor` / `calculate_fee_breakdown` | Arithmetic correctness |
| `update_fee_strategy` | Strategy confusion |

### 3.5 Governance and Multisig

| Function | Primary Risk |
|---|---|
| `migrate_to_governance` | One-time gate, legacy admin check |
| `propose` / `vote` / `execute` / `expire_proposal` | Vote manipulation, timelock bypass |
| `propose_operation` / `approve_operation` / `expire_operation` | Multisig threshold enforcement |
| `set_multisig_config` | Threshold underflow / lockout |
| `add_admin` / `remove_admin` / `is_admin` | Last-admin protection |
| `propose_admin` / `accept_admin` | Two-step handover integrity |
| `cleanup_expired_proposals` | Storage reclamation auth |

### 3.6 Circuit Breaker / Pause

| Function | Primary Risk |
|---|---|
| `pause` / `unpause` | Bypass of timelock/quorum |
| `emergency_pause` / `emergency_unpause` | Role check |
| `vote_unpause` | Quorum logic |
| `set_pause_timelock` / `set_unpause_quorum` / `set_cooldown_period` | Parameter bounds |

### 3.7 Compliance (Blacklist, KYC, Rate Limits)

| Function | Primary Risk |
|---|---|
| `blacklist_user` / `remove_from_blacklist` / `set_user_blacklisted` | Admin-only |
| `set_kyc_approved` / `is_kyc_approved` | Expiry enforcement |
| `set_daily_limit` / `get_daily_limit_status` | Rolling window arithmetic |
| `update_rate_limit_config` / `get_rate_limit_status` | Per-address rate accounting |
| `assign_role` / `remove_role` / `has_role` | Role escalation |

### 3.8 Asset Verification

| Function | Primary Risk |
|---|---|
| `set_asset_verification` | Admin-only; data integrity |
| `validate_asset_safety` | Suspicious-asset bypass |

### 3.9 Migration

| Function | Primary Risk |
|---|---|
| `export_migration_snapshot` | Lock-and-drain pattern |
| `import_migration_batch` | Hash verification, out-of-order import |

### 3.10 Transaction Controller

| Function | Primary Risk |
|---|---|
| `execute_transaction` | No explicit `require_auth` — see Known Issues §4 |
| `retry_transaction` | Re-entry into RolledBack state |
| `get_transaction_status` | Read-only |

### 3.11 Agent Management and Reputation

| Function | Primary Risk |
|---|---|
| `register_agent` / `remove_agent` | Admin-only |
| `set_agent_daily_cap` / `set_min_agent_reputation` | Parameter bounds |
| `get_agent_stats` / `get_agent_reputation` | Read-only, data integrity |

---

## 4. Out of Scope

The following components are **explicitly excluded** from this audit engagement:

| Component | Reason |
|---|---|
| `api/` — TypeScript REST API service | Off-chain; separate security review |
| `backend/` — TypeScript event listener, webhook handler, KYC service | Off-chain; separate security review |
| `frontend/` — React/Vite web application | Off-chain; separate security review |
| `mobile/` — React Native mobile app | Off-chain; separate security review |
| `sdk/` — TypeScript client SDK | Off-chain; separate security review |
| `scripts/` — Deployment and maintenance scripts | Operational, not on-chain |
| Docker images and `docker-compose.yml` | Infrastructure layer |
| `charts/` — Helm charts | Infrastructure layer |
| `backend/migrations/` — PostgreSQL schema | Off-chain database |
| Off-chain KYC / SEP-24 anchor integrations | Third-party services |
| FX rate provider integrations | Third-party services |
| `fuzz/` targets | Supplementary — auditor may review but not required |

> Off-chain services process data that eventually reaches the contract. Any trust assumption the contract places on off-chain inputs (e.g., `recipient_hash`, `proof`, `evidence_hash`) is in scope from the **contract's perspective** — the auditor should assess whether the contract adequately validates these inputs on-chain without relying on off-chain correctness guarantees.

---

## 5. Known Limitations (from PRODUCTION_READINESS_REPORT.md)

The following were documented in the production readiness report dated 2026-03-27. The auditor should assess the current state of each item against the audit-freeze commit.

### 5.1 Experimental / Partially Implemented Modules

| Module | Reported Limitation | Impact |
|---|---|---|
| `transaction_controller.rs` | Missing constants (`RETRY_DELAY_SECS`, `MAX_RETRIES`); type mismatches in transaction tracking | Functional risk; incomplete retry semantics |
| `asset_verification.rs` | Stub implementation; `VerificationStatus` enum not fully defined; missing storage functions | `validate_asset_safety` may not fully enforce suspicious-asset checks |
| `abuse_protection.rs` | `TRANSFER_COOLDOWN` constant not defined; pattern matching issues | Abuse detection may have gaps |
| `hashing.rs` | `compute_settlement_id_from_remittance` not implemented | Settlement ID derivation may fall back to legacy path |

### 5.2 Pre-Mainnet Checklist Items (Incomplete at Report Date)

- Testnet deployment not yet executed at report date
- Monitoring and alerting not yet configured
- Load testing not yet completed
- Emergency response procedures not yet trained

### 5.3 Architectural Risks

- `batch_settle_with_netting` has no `require_auth` call (see Known Issues §2)
- `execute_transaction` has no explicit `require_auth` call (see Known Issues §4)
- Error code gap: codes 70–82 are unassigned in `ContractError` (see Known Issues §3)
- `mark_failed` naming inconsistency: sets status to `Cancelled` not `Failed` (see Known Issues §1)

---

## 6. Test Coverage Summary

### 6.1 Unit and Integration Tests (`src/test*.rs`)

| Test File | Scope |
|---|---|
| `src/test.rs` | Core lifecycle: init, agent registration, fee updates, remittance creation, payout confirmation, cancellation, fee withdrawal, authorization, error conditions, event emission, multiple remittances, fee calculation accuracy |
| `src/test_transitions.rs` | State machine: all valid and invalid `RemittanceStatus` transitions |
| `src/test_fee_breakdown.rs` | Fee breakdown computation for all strategy types |
| `src/test_fee_corridor.rs` | Corridor-specific fee application |
| `src/test_fee_overflow.rs` | Arithmetic overflow/underflow protection in fee paths |
| `src/test_fee_differential.rs` | Fee differential between strategies |
| `src/test_fee_strategy.rs` | Fee strategy switching (Percentage / Flat / Dynamic) |
| `src/test_fee_property.rs` | Property-based fee invariants |
| `src/test_escrow.rs` | Standalone escrow lifecycle: create, release, refund, expiry |
| `src/test_dispute.rs` | Dispute flow: `mark_failed` → `raise_dispute` → `resolve_dispute` |
| `src/test_governance.rs` | Governance DAO: proposal lifecycle, vote, execute, timelock |
| `src/test_governance_integration.rs` | Multi-admin governance integration |
| `src/test_governance_property.rs` | Property-based governance invariants |
| `src/test_multisig.rs` | M-of-N multisig: propose, approve, auto-execute at threshold |
| `src/test_roles.rs` / `src/test_roles_simple.rs` | RBAC: assign_role, remove_role, has_role |
| `src/test_blacklist.rs` | Blacklist enforcement in remittance creation |
| `src/test_limits_and_proof.rs` | Daily send limits, proof commitment validation |
| `src/test_batch_create.rs` | Batch remittance creation atomicity |
| `src/test_migration.rs` | Export/import migration: hash verification, batch ordering |
| `src/test_agent_stats.rs` | Agent reputation scoring |
| `src/test_agent_migration.rs` | Agent state migration |
| `src/test_circuit_breaker.rs` | Pause/unpause, circuit breaker state |
| `src/test_token_whitelist.rs` | Token whitelist enforcement |
| `src/test_protocol_fee.rs` | Protocol fee accumulation and treasury routing |
| `src/test_treasury.rs` | Treasury address update and fee routing |
| `src/test_transfer_state.rs` | Transfer state query functions |
| `src/test_invariants.rs` | Global invariants: fee conservation, escrow balance |
| `src/test_state_machine_property.rs` | Property-based state machine invariants |
| `src/test_property.rs` | General property-based tests |
| `src/test_integrator_fees.rs` | Integrator fee accumulation and withdrawal |
| `src/test_coverage_gaps.rs` | Targeted tests for previously uncovered paths |
| `src/test_features_589_592.rs` | Feature-specific regression tests |
| `src/test_recipient_verification.rs` | Recipient hash commitment validation |
| `src/fee_service_property_tests.rs` | Property-based fee service tests |
| `src/fee_calculation_standalone_tests.rs` | Standalone fee calculation unit tests |
| `src/health_test.rs` | `health()` query correctness |
| `src/test_contract_upgrade.rs` | Contract upgrade path tests |

### 6.2 Integration Tests (`tests/`)

| File | Scope |
|---|---|
| `tests/integration/main.rs` | End-to-end flow against a local Soroban environment |

### 6.3 Fuzz Tests (`fuzz/fuzz_targets/`)

| Target | Input |
|---|---|
| `fuzz_validate_amount.rs` | Arbitrary amount values |
| `fuzz_validate_corridor.rs` | Arbitrary corridor fee config inputs |
| `fuzz_validate_recipient_hash.rs` | Arbitrary recipient hash byte sequences |

### 6.4 Benchmark Suite (`benches/`)

| Benchmark | Scope |
|---|---|
| `settlement_storage.rs` | Storage read/write throughput |
| `fee_calculation.rs` | Fee calculation throughput |
| `batch_expiry.rs` | Batch expiry processing throughput |
| `abuse_protection.rs` | Abuse detection throughput |
| `core_flow.rs` | End-to-end remittance flow latency |

### 6.5 Property-Based Testing

The contract uses [`proptest`](https://crates.io/crates/proptest) for property-based tests. Key invariants tested:

- Fee conservation: `net_disbursed + fee_accumulated == gross_amount` for every settlement
- State machine: no path from a terminal state to a non-terminal state
- No overflow in fee arithmetic for any input in `[0, u128::MAX]`
- Agent reputation score is always in `[0, 100]`
- Daily limit tracking never allows `used > limit` after enforcement

### 6.6 Coverage Gaps (Known)

The following areas have limited or no dedicated test coverage as of the audit-freeze date:

- `oracle.rs` — Oracle price feed integration is stub; no test coverage
- `debug.rs` — Debug utilities are feature-gated; only lightly tested
- `execute_transaction` retry path under concurrent ledger conditions
- `batch_settle_with_netting` with adversarial netting inputs (amounts that cancel to zero)
- Circuit-breaker cooldown period enforcement during high-volume replay

---

## 7. Audit Deliverables Expected

| Deliverable | Description |
|---|---|
| Findings report | Enumerated findings with severity, description, PoC (where applicable), recommendation |
| Executive summary | Non-technical summary for stakeholders |
| Re-audit attestation | Written confirmation that all Critical/High findings are remediated |
| Updated `FINDINGS_TRACKER.md` | Auditor populates Status and Re-audit Result columns |

---

## 8. Severity Classification

| Severity | Definition |
|---|---|
| **Critical** | Direct loss of user funds, unauthorized minting/draining, complete access control bypass |
| **High** | Significant fund risk, governance capture, irreversible state corruption |
| **Medium** | Limited fund risk under specific conditions, DoS on key functions, logic errors without direct fund impact |
| **Low** | Minor logic errors, hardening improvements, best-practice violations |
| **Informational** | Code quality, documentation, style |

---

## 9. Contact and Escalation

| Role | Contact | Response SLA |
|---|---|---|
| Lead Engineer | `<!-- FILL IN -->` | 4 h (critical), 24 h (other) |
| Security Lead | `<!-- FILL IN -->` | 4 h (critical), 24 h (other) |
| Audit Firm Lead | `<!-- FILL IN -->` | Per engagement contract |
| Emergency (fund risk) | `security@swiftremit.example` | Immediate |

> For Critical findings discovered during the audit that represent immediate fund risk, the auditor should contact the emergency address directly and not wait for the standard disclosure timeline.

---

## 10. Rules of Engagement

1. The audit covers the codebase at the commit hash recorded in §1.
2. No contract source files may be modified after the audit freeze commit without a scope-change notification and updated commit hash.
3. The auditor must not interact with the deployed testnet contract beyond read-only RPC queries during the audit period.
4. All findings must be submitted via the `FINDINGS_TRACKER.md` process before the final report is issued.
5. The contract **must not be deployed to mainnet** until all Critical and High findings are remediated and a re-audit attestation is issued.
