# SwiftRemit Documentation Index

This directory is the single source of truth for all SwiftRemit documentation
beyond the top-level README. Every document listed here is current; anything
that used to live at the repository root has been moved or deleted (SR-115).

---

## Quick Navigation

| Document | Description |
|---|---|
| [QUICK_START.md](QUICK_START.md) | Get running locally with Docker Compose |
| [GETTING_STARTED.md](GETTING_STARTED.md) | Manual setup and first deployment |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Full deployment guide (testnet → mainnet) |
| [TESTNET_SETUP_GUIDE.md](TESTNET_SETUP_GUIDE.md) | Automated testnet setup script walkthrough |
| [CONFIGURATION.md](CONFIGURATION.md) | All environment variables and config options |
| [MIGRATION.md](MIGRATION.md) | Contract migration guide |
| [RUNBOOK.md](RUNBOOK.md) | Day-to-day operational runbook — pause/unpause, key rotation, stuck migrations, SLO-alert response. Start here; for mainnet rollback see ROLLBACK_RUNBOOK.md |

---

## By Topic

### API & Protocol

| Document | Description |
|---|---|
| [api/API.md](api/API.md) | REST API reference |
| [api/OPENAPI.md](api/OPENAPI.md) | OpenAPI spec, implementation notes, and test results |
| [EVENTS.md](EVENTS.md) | Contract event catalogue (topics, payload shapes) |
| [WEBHOOKS.md](WEBHOOKS.md) | Webhook integration guide (SR-026) |
| [TRACING.md](TRACING.md) | Distributed tracing setup |

### Smart Contract

| Document | Description |
|---|---|
| [TRANSACTION_CONTROLLER.md](TRANSACTION_CONTROLLER.md) | Transaction controller design |
| [TRANSACTION_STATE_MACHINE.md](TRANSACTION_STATE_MACHINE.md) | Remittance lifecycle state machine |
| [FEE_SERVICE.md](FEE_SERVICE.md) | Fee calculation service — architecture, API, and refactor history |
| [ASSET_VERIFICATION.md](ASSET_VERIFICATION.md) | Asset verification system |

### Testing

| Document | Description |
|---|---|
| [testing/PROPERTY_TESTING.md](testing/PROPERTY_TESTING.md) | Property-based test suite — guide, examples, index, and checklist |
| [testing/STATE_MACHINE_TESTING.md](testing/STATE_MACHINE_TESTING.md) | State machine test guide |
| [testing/TESTING_COMPLETE.md](testing/TESTING_COMPLETE.md) | Test completion report |
| [testing/TESTING_FEE_BREAKDOWN.md](testing/TESTING_FEE_BREAKDOWN.md) | Fee breakdown test results |
| [PACT_BROKER.md](PACT_BROKER.md) | Pact Broker setup and the `can-i-deploy` deploy gate (SR-216) |

### Security & Compliance

| Document | Description |
|---|---|
| [THREAT_MODEL.md](THREAT_MODEL.md) | Threat model and attack surface analysis |
| [COMPLIANCE_CONTROLS.md](COMPLIANCE_CONTROLS.md) | AML/KYC compliance controls |
| [VULNERABILITY_EXCEPTIONS.md](VULNERABILITY_EXCEPTIONS.md) | Known vulnerability exceptions |
| [VULNERABILITY_RESPONSE_SLA.md](VULNERABILITY_RESPONSE_SLA.md) | Vulnerability response SLAs |
| [KEY_MANAGEMENT_POLICY.md](KEY_MANAGEMENT_POLICY.md) | Key management policy |
| [REPRODUCIBLE_BUILD.md](REPRODUCIBLE_BUILD.md) | Reproducible build verification |
| [audit/AUDIT_SCOPE.md](audit/AUDIT_SCOPE.md) | Security audit scope |
| [audit/AUDIT_CHECKLIST.md](audit/AUDIT_CHECKLIST.md) | Audit checklist |
| [audit/KNOWN_ISSUES.md](audit/KNOWN_ISSUES.md) | Known issues tracker |
| [audit/ARCHITECTURE.md](audit/ARCHITECTURE.md) | Architecture document for auditors |
| [audit/FINDINGS_TRACKER.md](audit/FINDINGS_TRACKER.md) | Audit findings tracker |

### Operations

| Document | Description |
|---|---|
| [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md) | Production readiness assessment |
| [PRODUCTION_READINESS_CHECKLIST.md](PRODUCTION_READINESS_CHECKLIST.md) | Pre-mainnet checklist |
| [ROLLBACK_RUNBOOK.md](ROLLBACK_RUNBOOK.md) | Canonical mainnet incident recovery — severity matrix, WASM rollback, state migration, authority matrix |
| [DATA_INVENTORY.md](DATA_INVENTORY.md) | Data inventory and retention policy |
| [ISSUES.md](ISSUES.md) | Issue tracker (SR-series) |

### Implementation Notes

| Document | Description |
|---|---|
| [implementation/IMPLEMENTATION_SUMMARY.md](implementation/IMPLEMENTATION_SUMMARY.md) | Overall implementation summary |
| [implementation/BATCH_REMITTANCE.md](implementation/BATCH_REMITTANCE.md) | Batch remittance implementation |
| [implementation/ABUSE_PROTECTION.md](implementation/ABUSE_PROTECTION.md) | Abuse protection implementation |
| [implementation/PROOF_OF_PAYOUT.md](implementation/PROOF_OF_PAYOUT.md) | Proof-of-payout implementation |
| [implementation/CURRENCY_API.md](implementation/CURRENCY_API.md) | Currency API implementation |
| [implementation/TRANSACTION_CONTROLLER_IMPL.md](implementation/TRANSACTION_CONTROLLER_IMPL.md) | Transaction controller implementation notes |

### Integrations & SDKs

| Document | Description |
|---|---|
| [ANCHOR_QUICKSTART.md](ANCHOR_QUICKSTART.md) | SEP-24 anchor quick-start |
| [ANCHOR_SELECTION.md](ANCHOR_SELECTION.md) | Anchor selection guide |
| [STELLAR_WALLETS_KIT.md](STELLAR_WALLETS_KIT.md) | Stellar Wallets Kit React integration guide |
| [MOBILE_FEATURE_PARITY.md](MOBILE_FEATURE_PARITY.md) | Mobile feature parity status |

### Design

| Document | Description |
|---|---|
| [design/login-ui.md](design/login-ui.md) | Login UI design |
| [design/landing-page.md](design/landing-page.md) | Landing page design |
| [design/settings-ui.md](design/settings-ui.md) | Settings UI design |
| [design/color-palette.md](design/color-palette.md) | Color palette |
| [UI_DESIGN.md](UI_DESIGN.md) | UI design overview |

---

## Root-level files (allowlist)

Only these files are permitted at the repository root:

- `README.md` — project overview and quick-start
- `CONTRIBUTING.md` — contributor guide
- `SECURITY.md` — security policy and disclosure process
- `CHANGELOG.md` — release changelog
- `ROADMAP.md` — shipped features and planned work

A CI check (`scripts/check-root-markdown.sh`) enforces this list and fails the
build if any other `.md` file appears at root.
