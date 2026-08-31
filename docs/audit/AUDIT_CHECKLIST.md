# SwiftRemit — External Audit Pre-Engagement Checklist

> **Purpose:** Ensure the auditor has everything needed to begin work on day one.
> Complete every item in Section 1 before the audit kick-off call.
>
> Audit firm: TBD  
> Engagement start: TBD  
> Engagement contact: security@swiftremit.example  
> Last updated: 2026-07-30

---

## Section 1 — Repository and Build

| # | Item | Status | Notes |
|---|---|---|---|
| 1.1 | Auditor GitHub account added to repo with read access | ☐ Pending | |
| 1.2 | Contract branch/tag frozen for audit (no new `pub fn` without auditor agreement) | ☐ Pending | Branch: `audit/sr-109` |
| 1.3 | Contract builds cleanly: `cargo build --target wasm32-unknown-unknown --release` | ☐ Pending | Must produce zero warnings |
| 1.4 | All Rust tests pass: `cargo test` | ☐ Pending | |
| 1.5 | Clippy passes: `cargo clippy -- -D warnings` | ☐ Pending | |
| 1.6 | Optimised WASM produced: `stellar contract optimize --wasm target/wasm32-unknown-unknown/release/swiftremit.wasm` | ☐ Pending | |
| 1.7 | WASM hash (SHA-256) documented and pinned | ☐ Pending | Hash: _TBD_ |
| 1.8 | Rust toolchain version confirmed: `cat rust-toolchain.toml` | ☐ Pending | Currently: `stable` |
| 1.9 | `soroban-sdk` version confirmed: `grep soroban-sdk Cargo.toml` | ☐ Pending | Currently: `26.1.0` |

---

## Section 2 — Documentation Provided to Auditor

| # | Document | Path | Status |
|---|---|---|---|
| 2.1 | Audit scope | `docs/audit/AUDIT_SCOPE.md` | ✅ Ready |
| 2.2 | Contract architecture | `docs/audit/ARCHITECTURE.md` | ✅ Ready |
| 2.3 | Known issues (pre-disclosure) | `docs/audit/KNOWN_ISSUES.md` | ✅ Ready |
| 2.4 | Findings tracker (empty, for auditor use) | `docs/audit/FINDINGS_TRACKER.md` | ✅ Ready |
| 2.5 | Threat model | `docs/THREAT_MODEL.md` | ✅ Ready |
| 2.6 | Full function list with auth requirements | `README.md` — Contract Functions | ✅ Ready |
| 2.7 | Authorization model | `SECURITY.md` | ✅ Ready |
| 2.8 | Events catalogue | `docs/EVENTS.md` | ✅ Ready |
| 2.9 | Error codes table | `README.md` — Error Codes | ✅ Ready |
| 2.10 | State machine diagram | `README.md` — State Machine | ✅ Ready |
| 2.11 | Production readiness report | `PRODUCTION_READINESS_REPORT.md` | ✅ Ready |
| 2.12 | ABI (JSON) | `abi/swiftremit-v1.json` | ✅ Ready |

---

## Section 3 — Test Suite

| # | Item | Command | Status |
|---|---|---|---|
| 3.1 | Core contract tests | `cargo test` | ☐ Run and confirm |
| 3.2 | Transition tests | `cargo test --test test_transitions` | ☐ Run and confirm |
| 3.3 | Governance tests | `cargo test test_governance` | ☐ Run and confirm |
| 3.4 | Property-based tests | `cargo test test_property` | ☐ Run and confirm |
| 3.5 | Fee differential tests | `cargo test test_fee_differential` | ☐ Run and confirm |
| 3.6 | Migration tests | `cargo test test_migration` | ☐ Run and confirm |
| 3.7 | Fuzz targets (optional) | `cargo +nightly fuzz run fuzz_validate_amount` | ☐ Optional |

Test files are located in `src/test*.rs`. All tests use the `soroban-sdk` test
environment (`soroban_sdk::Env::default()`) — no live network connection is required.

---

## Section 4 — Testnet Environment

| # | Item | Value | Status |
|---|---|---|---|
| 4.1 | Soroban testnet RPC URL | `https://soroban-testnet.stellar.org` | ✅ Public |
| 4.2 | Horizon testnet URL | `https://horizon-testnet.stellar.org` | ✅ Public |
| 4.3 | Testnet contract ID | _TBD — provide before audit start_ | ☐ Pending |
| 4.4 | Mock USDC token ID | _TBD — provide before audit start_ | ☐ Pending |
| 4.5 | Funded test admin account | _TBD — share via secure channel_ | ☐ Pending |
| 4.6 | Funded test agent account | _TBD — share via secure channel_ | ☐ Pending |
| 4.7 | Funded test sender account | _TBD — share via secure channel_ | ☐ Pending |
| 4.8 | Setup script runs cleanly | `./setup-testnet.sh` | ☐ Pending |

---

## Section 5 — Scope Clarifications

**In scope:**
- All Rust source files in `src/` (smart contract)
- Contract ABI (`abi/swiftremit-v1.json`)
- Deployment scripts (`deploy.sh`, `setup-testnet.sh`) for logic issues

**Out of scope:**
- `backend/` TypeScript service (separate engagement)
- `frontend/` React application
- `mobile/` React Native application
- `sdk/` TypeScript SDK
- Stellar network protocol and USDC token contract
- Third-party anchor providers (SEP-24)

**Prioritised areas (highest concern):**
1. Escrow and fund custody (`create_remittance`, `confirm_payout`, `cancel_remittance`)
2. Batch netting (`batch_settle_with_netting`) — see KI-001
3. Governance and multisig (`propose_operation`, `approve_operation`, `migrate_to_governance`)
4. Admin key operations (`withdraw_fees`, `add_admin`, `remove_admin`)
5. Circuit breaker bypass paths (`pause`, `unpause`, `emergency_pause`)
6. Migration (`export_migration_snapshot`, `import_migration_batch`)

---

## Section 6 — Communication and Deliverables

| # | Item | Status |
|---|---|---|
| 6.1 | Kick-off call scheduled | ☐ Pending |
| 6.2 | Secure communication channel established (Signal/encrypted email) | ☐ Pending |
| 6.3 | Agreed NDA / engagement contract signed | ☐ Pending |
| 6.4 | Interim findings cadence agreed (e.g. weekly sync) | ☐ Pending |
| 6.5 | Draft report delivery date agreed | ☐ Pending |
| 6.6 | Re-audit scope and timeline agreed | ☐ Pending |
| 6.7 | Public report publication process agreed | ☐ Pending |

**Engagement contacts:**

| Role | Name | Contact |
|---|---|---|
| Security Lead | [PLACEHOLDER] | security@swiftremit.example |
| Lead Developer | [PLACEHOLDER] | [PLACEHOLDER] |
| Project Manager | [PLACEHOLDER] | [PLACEHOLDER] |

---

## Section 7 — Post-Audit Gates

The following must be satisfied before mainnet deployment:

1. ✅ Audit report delivered and reviewed by Security Lead.
2. ✅ All Critical findings: `Re-audited` in `FINDINGS_TRACKER.md`.
3. ✅ All High findings: `Re-audited` in `FINDINGS_TRACKER.md`.
4. ✅ Medium findings: `Remediated` or formally `Accepted` with sign-off.
5. ✅ Re-audit report delivered and published.
6. ✅ Security Lead and 2 admin keyholders sign off on `FINDINGS_TRACKER.md`.
7. ✅ Mainnet deployment gate in `FINDINGS_TRACKER.md` fully checked.
