# SwiftRemit

[![Soroban Contract CI](https://github.com/Haroldwonder/SwiftRemit/actions/workflows/contract-ci.yml/badge.svg)](https://github.com/Haroldwonder/SwiftRemit/actions/workflows/contract-ci.yml)

Production-ready Soroban smart contract for USDC remittance platform on Stellar blockchain.

## Overview

SwiftRemit is an escrow-based remittance system that enables secure cross-border money transfers using USDC stablecoin. The platform connects senders with registered agents who handle fiat payouts, with the smart contract managing escrow, fee collection, and settlement.

## Features

- **Escrow-Based Transfers**: Secure USDC deposits held in contract until payout confirmation
- **Agent Network**: Registered agents handle fiat distribution off-chain
- **Automated Fee Collection**: Platform fees calculated and accumulated automatically
- **Lifecycle State Management**: Remittances tracked through 6 states (Pending, Processing, Completed, Cancelled, Failed, Disputed) with enforced transitions via a single canonical `RemittanceStatus` enum
- **Authorization Security**: Role-based access control for all operations
- **Event Emission**: Comprehensive event logging for off-chain monitoring
- **Cancellation Support**: Senders can cancel pending remittances with full refund
- **Admin Controls**: Platform fee management and fee withdrawal capabilities
- **Daily Send Limits**: Admin-configurable rolling 24h limits per currency/country
- **Off-Chain Proof Commitments**: Optional proof validation before payout confirmation

## Architecture

```mermaid
graph TB
    subgraph Users["Users / Clients"]
        S[Sender]
        A[Agent]
        ADM[Admin]
    end

    subgraph Frontend["Frontend (React/Vite)"]
        UI[UI Components]
        VB[VerificationBadge]
    end

    subgraph API["API Service (TypeScript)"]
        REST[REST Endpoints]
        FX[FX Rate / Currency API]
        CFG[Config Loader]
    end

    subgraph Backend["Backend Service (TypeScript)"]
        EVT[Event Listener / Stellar SDK]
        WH[Webhook Handler]
        KYC[KYC Service]
        ANC[Anchor Client]
        DB[(PostgreSQL)]
        SCH[Scheduler / Poller]
    end

    subgraph Contract["Smart Contract (Soroban / Rust)"]
        LIB[lib.rs — Public API]
        STOR[storage.rs]
        TRANS[transitions.rs]
        FEES[fee_service.rs]
        HLTH[health.rs]
        RATE[rate_limit.rs]
        ABUSE[abuse_protection.rs]
    end

    subgraph Stellar["Stellar Network"]
        LEDGER[Ledger]
        USDC[USDC Token Contract]
    end

    subgraph AssetVerif["Asset Verification"]
        AV[asset_verification.rs]
        EXPERT[Stellar Expert API]
        TOML[stellar.toml]
    end

    S -->|create_remittance / cancel| UI
    A -->|confirm_payout| UI
    ADM -->|register_agent / withdraw_fees| UI
    UI --> REST
    REST --> LIB
    LIB --> STOR
    LIB --> TRANS
    LIB --> FEES
    LIB --> RATE
    LIB --> ABUSE
    LIB --> HLTH
    LIB --> AV
    LIB -->|token.transfer| USDC
    USDC --> LEDGER
    LEDGER -->|contract events| EVT
    EVT --> WH
    WH -->|deliver webhooks| DB
    WH -->|notify| S
    EVT --> KYC
    KYC --> ANC
    KYC --> DB
    SCH -->|poll KYC / FX| ANC
    SCH --> DB
    AV -->|off-chain checks| EXPERT
    AV -->|off-chain checks| TOML
    Backend -->|health check| HLTH
    Frontend --> FX
    FX --> CFG
```

### Core Components

- **lib.rs**: Main contract implementation with all public functions
- **types.rs**: Data structures (Remittance, RemittanceStatus)
- **transitions.rs**: State transition validation and enforcement
- **storage.rs**: Persistent and instance storage management
- **errors.rs**: Custom error types for contract operations
- **events.rs**: Event emission functions for monitoring
- **test.rs**: Comprehensive test suite with 15+ test cases
- **test_transitions.rs**: Lifecycle transition tests

### Storage Model

- **Instance Storage**: Admin, USDC token, fee configuration, counters, accumulated fees
- **Persistent Storage**: Individual remittances, agent registrations

### Fee Calculation

Fees are calculated in basis points (bps):
- 250 bps = 2.5%
- 500 bps = 5.0%
- Formula: `fee = amount * fee_bps / 10000`

## Contract Functions

The contract exposes 134 public functions from a single `#[contractimpl] impl SwiftRemitContract` block in [`src/lib.rs`](src/lib.rs). This list is generated from `grep -n "pub fn " src/lib.rs` and is grouped by domain below. "Auth" describes what `require_auth()` / role check (if any) gates the call.

> This table is the source of truth for the deployed ABI. A CI check (`scripts/check_readme_functions.sh`, wired into `contract-ci.yml`) fails the build if a `pub fn` is added to the `impl` block without a matching entry here — see [Keeping this list in sync](#keeping-this-list-in-sync) below.

### Administrative / Setup

| Function | Description | Auth |
|---|---|---|
| `initialize(admin, usdc_token, fee_bps, rate_limit_cooldown, protocol_fee_bps, treasury)` | One-time contract setup: sets admin, USDC token, platform fee, rate-limit cooldown, protocol fee, and treasury; initializes counters | Callable once only (fails with `AlreadyInitialized` afterward) |
| `register_agent(agent, kyc_hash?)` | Registers an address as an authorized payout agent and grants the `Settler` role, optionally storing a KYC hash | admin only |
| `remove_agent(agent)` | Revokes an agent's authorization and `Settler` role | admin only |
| `update_fee(fee_bps)` | Updates the global platform fee (bps) | admin only |
| `add_admin(caller, new_admin)` | Grants admin role to a new address | admin only |
| `remove_admin(caller, admin_to_remove)` | Revokes admin role (blocks removing the last admin) | admin only |
| `is_admin(address)` | Checks whether an address currently has admin privileges | none (public query) |
| `get_admin_count()` | Returns the number of registered admins | none (public query) |
| `propose_admin(new_admin)` | Step 1 of a 2-step admin handover — proposes a successor | admin only |
| `accept_admin()` | Step 2 of a 2-step admin handover — proposed address accepts | proposed-admin auth required |
| `extend_storage_ttl(caller, extend_by_ledgers)` | Bumps TTL on instance/persistent storage to prevent expiry | admin only |

### Agent Management & Reputation

| Function | Description | Auth |
|---|---|---|
| `is_agent_registered(agent)` | Checks if an address is a registered agent | none (public query) |
| `get_agent_kyc_hash(agent)` | Returns the stored KYC metadata hash for an agent, if any | none (public query) |
| `get_agent_stats(agent)` | Returns full agent stats (settlements, failures, disputes, success rate) | none (public query) |
| `get_agent_reputation(agent)` | Computes a reputation score from an agent's stats | none (public query) |
| `set_agent_daily_cap(agent, cap)` | Sets a rolling 24h payout cap for an agent (0 = no cap) | admin only |
| `get_agent_daily_cap(agent)` | Returns an agent's daily payout cap | none (public query) |
| `set_min_agent_reputation(threshold)` | Sets the minimum reputation (0–100) an agent needs to receive new remittances | admin only |
| `get_min_agent_reputation()` | Returns the current minimum reputation threshold | none (public query) |

### Remittance Lifecycle

| Function | Description | Auth |
|---|---|---|
| `create_remittance(sender, agent, amount, expiry?, token?, idempotency_key?, settlement_config?, recipient_hash?)` | Creates a pending remittance: validates agent/reputation/token whitelist, enforces daily send limit and corridor caps, checks idempotency, and moves funds into escrow | sender auth required |
| `create_remittance_with_corridor(sender, agent, amount, expiry?, from_country?, to_country?)` | Like `create_remittance`, but applies a country-pair fee corridor if one is configured | sender auth required |
| `confirm_payout(agent, remittance_id, proof?, recipient_details_hash?)` | Agent confirms payout: transitions Pending → Processing → Completed, pays the agent (minus fees), pays the treasury protocol fee, and locks the settlement hash against double payout | agent auth required (must be the remittance's assigned, registered agent) |
| `mark_failed(remittance_id)` | Refunds the escrow to the sender and sets the remittance status to `Cancelled` (despite the name, it does not set a `Failed` status — see note below) | agent auth required (assigned agent) |
| `raise_dispute(remittance_id, evidence_hash)` | Sender disputes a remittance in the `Failed` status, within the dispute window | sender auth required |
| `resolve_dispute(remittance_id, in_favour_of_sender)` | Admin resolves a disputed remittance — refunds the sender or pays the agent | admin only |
| `set_dispute_window(seconds)` | Sets how long after failure a sender may raise a dispute | admin only |
| `get_dispute_window()` | Returns the current dispute window in seconds | none (public query) |
| `confirm_partial_payout(remittance_id, amount)` | Disburses a partial amount toward a remittance; auto-completes once fully disbursed | agent auth required (assigned agent) |
| `finalize_remittance(caller, remittance_id)` | Verifies a remittance is in the `Completed` status | admin only |
| `cancel_remittance(remittance_id)` | Sender cancels a pending remittance and receives a full refund | sender auth required |
| `process_expired_remittances(remittance_ids)` | Batch-refunds expired pending remittances from the given ID list (max batch size configurable, see `set_max_expired_batch_size`) | none (callable by anyone) |
| `get_remittance(remittance_id)` | Fetches a remittance record | none (public query) |
| `get_remittances_by_sender(sender, offset, limit)` | Paginated list of a sender's remittance IDs (max page 100) | none (public query) |
| `get_remittances_by_agent(agent, offset, limit)` | Paginated list of an agent's remittance IDs (max page 100) | none (public query) |
| `get_remittance_count()` | Total number of remittances ever created | none (public query) |
| `get_total_volume()` | Cumulative volume of completed remittances | none (public query) |
| `get_in_flight_volume()` | Total amount currently in the `Processing` status | none (public query) |
| `get_transfer_state(transfer_id)` | Returns a remittance's current status | none (public query) |
| `compute_settlement_hash(remittance_id)` | Computes the deterministic settlement hash for a remittance | none (public query) |
| `get_settlement_hash(remittance_id)` | Returns the stored settlement hash once settled | none (public query) |

> **Note:** there is no separate `start_processing` function — the `Pending → Processing` transition happens as an internal step inside `confirm_payout`, not as its own callable entry point.

### Escrow

| Function | Description | Auth |
|---|---|---|
| `create_escrow(sender, recipient, amount)` | Creates a standalone escrow (separate from remittances), pulling funds into the contract | sender auth required |
| `release_escrow(transfer_id)` | Releases escrowed funds to the recipient | admin only |
| `refund_escrow(transfer_id)` | Refunds escrowed funds back to the original sender | escrow's sender auth required |
| `get_escrow(transfer_id)` | Fetches an escrow record | none (public query) |
| `get_escrow_ttl()` | Returns the configured escrow TTL (seconds) | none (public query) |
| `update_escrow_ttl(ttl)` | Updates the escrow TTL | admin only |
| `process_expired_escrows(transfer_ids)` | Batch-refunds expired pending escrows from the given ID list | none (callable by anyone) |

### Batch / Netting

| Function | Description | Auth |
|---|---|---|
| `batch_create_remittances(sender, entries)` | Creates multiple remittances atomically with a single token transfer for the total | sender auth required |
| `create_batch_remittance(sender, entries)` | Wrapper around `batch_create_remittances` that also emits a batch-created event | sender auth required |
| `confirm_batch_payout(agent, remittance_ids)` | Confirms payout for multiple remittances in one call | agent auth required |
| `batch_settle_with_netting(entries)` | Nets opposing transfers between parties in a batch and settles only the net difference | **no `require_auth` in this function** — only blocked while the contract is paused; treat as a known gap if you're reviewing security posture |

### Fee Management, Corridors & Token Whitelist

| Function | Description | Auth |
|---|---|---|
| `get_platform_fee_bps()` | Returns the current global platform fee (bps) | none (public query) |
| `get_fee_breakdown(amount, from_country?, to_country?)` | Previews the fee split for an amount, using a corridor if a country pair is given | none (public query) |
| `update_protocol_fee(caller, fee_bps)` | Updates the protocol/treasury fee (max 200 bps) | admin only |
| `update_token_fee(caller, token, fee_bps)` | Sets the platform fee for a specific whitelisted token | admin only |
| `get_token_fee_bps(token)` | Returns the configured fee for a token | none (public query) |
| `update_treasury(caller, treasury)` | Updates the protocol-fee treasury address | admin only |
| `get_protocol_fee_bps()` | Returns the current protocol fee (bps) | none (public query) |
| `get_treasury()` | Returns the treasury address | none (public query) |
| `update_fee_strategy(caller, strategy)` | Switches the fee model between Percentage / Flat / Dynamic | admin only |
| `get_fee_strategy()` | Returns the current fee strategy | none (public query) |
| `calculate_fee_breakdown(amount)` | Computes the fee breakdown for an amount under the global strategy | none (public query) |
| `fee_breakdown_corridor(amount, corridor)` | Computes the fee breakdown for an amount under a given corridor config | none (public query) |
| `set_fee_corridor(caller, corridor)` | Configures corridor-specific fee rules for a country pair | admin only |
| `get_fee_corridor(from_country, to_country)` | Returns a corridor's fee config, if set | none (public query) |
| `remove_fee_corridor(caller, from_country, to_country)` | Deletes a corridor's fee config | admin only |
| `withdraw_fees(to)` | Withdraws all accumulated platform fees to `to` | admin only |
| `withdraw_integrator_fees(integrator, to)` | Withdraws accumulated integrator fees to `to` | integrator auth required |
| `get_accumulated_fees()` | Returns accumulated (unwithdrawn) platform fees | none (public query) |
| `get_accumulated_integrator_fees()` | Returns accumulated (unwithdrawn) integrator fees | none (public query) |
| `add_whitelisted_token(token)` | Adds a token to the whitelist | admin only |
| `remove_whitelisted_token(token)` | Removes a token from the whitelist | admin only |
| `is_token_whitelisted(token)` | Checks whitelist status | none (public query) |
| `get_whitelisted_tokens()` | Lists all whitelisted tokens | none (public query) |

### Rate Limits & Daily Limits

| Function | Description | Auth |
|---|---|---|
| `update_rate_limit(cooldown_seconds)` | Sets the settlement rate-limit cooldown (legacy single-value control) | admin only |
| `get_rate_limit_cooldown()` | Returns the settlement rate-limit cooldown | none (public query) |
| `get_last_settlement_time(sender)` | Returns the sender's last settlement timestamp, if any | none (public query) |
| `set_daily_limit(currency, country, limit)` | Sets a daily send limit for a currency/country corridor | admin only |
| `get_daily_limit(currency, country)` | Returns the configured daily limit for a corridor | none (public query) |
| `get_daily_limit_status(sender, currency, country)` | Returns `(limit, used, remaining, resets_at)` for a sender's rolling 24h window | none (public query) |
| `set_max_expired_batch_size(size)` | Sets the max batch size (1–200) for `process_expired_remittances` / `process_expired_escrows` | admin only |
| `update_rate_limit_config(caller, max_requests, window_seconds, enabled)` | Configures the general request rate limiter | admin only |
| `get_rate_limit_config()` | Returns `(max_requests, window_seconds, enabled)` | none (public query) |
| `get_rate_limit_status(address)` | Returns `(current_requests, max_requests, window_seconds)` for an address | none (public query) |

### Roles, Governance & Multisig

| Function | Description | Auth |
|---|---|---|
| `assign_role(caller, address, role)` | Grants a role (e.g. Admin, Settler) to an address | admin (`Admin` role) required |
| `remove_role(caller, address, role)` | Revokes a role from an address | admin (`Admin` role) required |
| `has_role(address, role)` | Checks if an address holds a role | none (public query) |
| `set_multisig_config(caller, threshold, ttl_seconds)` | Configures M-of-N threshold and TTL for admin multisig operations | admin only |
| `propose_operation(proposer, operation_type, fee_bps, withdraw_to?)` | Proposes a high-impact admin operation (auto-executes if threshold is 1) | admin only |
| `approve_operation(approver, operation_id)` | Approves a pending multisig operation; auto-executes at threshold | admin only |
| `expire_operation(operation_id)` | Cleans up a TTL-expired pending operation | none (callable by anyone) |
| `get_pending_operation(operation_id)` | Fetches a pending multisig operation | none (public query) |
| `migrate_to_governance(caller, quorum, timelock_seconds, proposal_ttl_seconds)` | One-time migration from single-admin to DAO governance | must be the legacy single admin |
| `propose(proposer, action)` | Creates a governance proposal | admin (`Admin` role) required |
| `vote(voter, proposal_id)` | Casts an approval vote on a proposal | admin (`Admin` role) required |
| `execute(executor, proposal_id)` | Executes an approved proposal after its timelock | admin (`Admin` role) required |
| `expire_proposal(proposal_id)` | Transitions a TTL-expired proposal to `Expired` | none (callable by anyone) |
| `cleanup_expired_proposals(caller, proposal_ids)` | Deletes executed/expired proposals to reclaim storage | admin (`Admin` role) required |
| `get_proposal(proposal_id)` | Fetches a proposal record | none (public query) |
| `get_quorum()` | Returns the governance quorum threshold | none (public query) |
| `get_timelock_seconds()` | Returns the governance timelock duration | none (public query) |
| `get_admin_list()` | Returns the list of current admin addresses | none (public query) |
| `get_governance_config()` | Returns `{quorum, timelock_seconds, proposal_ttl_seconds}` | none (public query) |

### Circuit Breaker / Pause

| Function | Description | Auth |
|---|---|---|
| `pause()` | Legacy wrapper: pauses the contract, bypassing quorum/timelock checks | admin only |
| `unpause()` | Legacy wrapper: unpauses the contract, bypassing quorum/timelock checks | admin only |
| `emergency_pause(caller, reason)` | Pauses the contract with a structured pause reason | admin (`Admin` role) required |
| `emergency_unpause(caller)` | Unpauses, enforcing the configured timelock and quorum | admin (`Admin` role) required |
| `vote_unpause(caller)` | Casts an admin vote to unpause; auto-unpauses at quorum | admin (`Admin` role) required |
| `set_pause_timelock(caller, seconds)` | Sets the required delay before unpause (max 7 days) | admin (`Admin` role) required |
| `set_unpause_quorum(caller, quorum)` | Sets the number of admin votes needed to unpause | admin (`Admin` role) required |
| `set_cooldown_period(caller, seconds)` | Sets the post-unpause cooldown during which rate limits are halved (max 7 days) | admin (`Admin` role) required |
| `get_cooldown_period()` | Returns the current post-unpause cooldown | none (public query) |
| `get_circuit_breaker_status()` | Full snapshot of circuit-breaker state | none (public query) |
| `get_pause_record(seq)` | Returns a specific historical pause record | none (public query) |
| `get_current_pause_record()` | Returns the active pause record, if paused | none (public query) |
| `get_pause_history_count()` | Returns the total number of pause events recorded | none (public query) |
| `is_paused()` | Checks if the contract is currently paused | none (public query) |

### Asset Verification

| Function | Description | Auth |
|---|---|---|
| `set_asset_verification(asset_code, issuer, status, reputation_score, trustline_count, has_toml)` | Stores off-chain-computed asset verification data (Stellar Expert / `stellar.toml` checks) | admin only |
| `get_asset_verification(asset_code, issuer)` | Fetches stored verification data for an asset | none (public query) |
| `has_asset_verification(asset_code, issuer)` | Checks if verification data exists for an asset | none (public query) |
| `validate_asset_safety(asset_code, issuer)` | Errors if the asset is flagged `Suspicious` | none (public query, errors on suspicious asset) |

### Blacklist / KYC / Compliance

| Function | Description | Auth |
|---|---|---|
| `blacklist_user(user)` | Adds a user to the blacklist | admin only |
| `remove_from_blacklist(user)` | Removes a user from the blacklist | admin only |
| `set_user_blacklisted(user, blacklisted)` | Directly sets a user's blacklist flag | admin only |
| `is_user_blacklisted(user)` | Checks blacklist status | none (public query) |
| `set_kyc_approved(user, approved, expiry)` | Sets a user's KYC approval status and expiry | admin only |
| `is_kyc_approved(user)` | Checks KYC approval (and that it hasn't expired) | none (public query) |

### Migration

| Function | Description | Auth |
|---|---|---|
| `export_migration_snapshot(caller)` | Exports a full contract state snapshot and sets a migration-in-progress lock (blocks `create_remittance` / `confirm_payout`) | admin only |
| `import_migration_batch(caller, batch)` | Imports one hash-verified batch of migrated state; clears the lock after the final batch | admin only |

### Transaction Controller

| Function | Description | Auth |
|---|---|---|
| `execute_transaction(user, agent, amount, expiry?)` | Runs a validate → KYC-check → create-remittance pipeline with retry logic | no explicit `require_auth`; enforced implicitly by the token contract requiring `user` to authorize the transfer |
| `get_transaction_status(remittance_id)` | Fetches the transaction record for a controller-managed transaction | none (public query) |
| `retry_transaction(remittance_id)` | Retries a transaction that rolled back (only valid from the `RolledBack` state) | same implicit auth as `execute_transaction` |

### General / System Queries

| Function | Description | Auth |
|---|---|---|
| `get_version()` | Returns the contract's package version string | none (public query) |
| `health()` | Returns init state, pause status, admin count, remittance count, accumulated fees | none (public query) |

### Keeping this list in sync

This list must contain one entry per `pub fn` inside the `#[contractimpl] impl SwiftRemitContract` block in `src/lib.rs`. `scripts/check_readme_functions.sh` enforces this in CI: it greps `src/lib.rs` for `pub fn` names inside that block and fails if any name isn't present in this file.

## Security Features

1. **Authorization Checks**: All state-changing operations require proper authorization
2. **Status Validation**: Prevents double confirmation and invalid state transitions
3. **Overflow Protection**: Safe math operations with overflow checks
4. **Agent Verification**: Only registered agents can receive payouts
5. **Ownership Validation**: Senders can only cancel their own remittances

## Testing

The contract includes comprehensive tests covering:

- ✅ Initialization and configuration
- ✅ Agent registration and removal
- ✅ Fee updates and validation
- ✅ Remittance creation with proper token transfers
- ✅ Payout confirmation and fee accumulation
- ✅ Cancellation logic and refunds
- ✅ Fee withdrawal by admin
- ✅ Authorization enforcement
- ✅ Error conditions (invalid amounts, unauthorized access, double confirmation)
- ✅ Event emission verification
- ✅ Multiple remittances handling
- ✅ Fee calculation accuracy

Run tests with:
```bash
cargo test
```

## Quick Start

### Prerequisites

- Rust toolchain as pinned in [`rust-toolchain.toml`](rust-toolchain.toml) (currently `stable`, installed automatically by `rustup` when you build in this repo)
- `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
- Soroban CLI (`soroban`)
- See [`Cargo.toml`](Cargo.toml) for the exact `soroban-sdk` version this contract is built against

### 🐳 Local Stack with Docker Compose

The Compose stack reads a **`.env` per service** (`backend/.env`, `api/.env`,
`frontend/.env`). Those files are gitignored; the tracked `.env.example` files are
templates only and are never read at runtime — placeholders would otherwise start
the services with dummy configuration, and editing an example to make things work
locally risks committing a real secret into a tracked file.

```bash
# 1. Create the per-service .env files (idempotent — never overwrites an existing one)
make setup            # or: ./scripts/setup-env.sh

# 2. Start everything
docker compose up --build
```

`make setup` copies each `.env.example` to `.env` and fills in working local
values — the Compose Postgres URL and freshly generated local secrets. Contract
specific values (`CONTRACT_ID`, `VITE_CONTRACT_ID`, `VITE_USDC_ISSUER`) stay
empty until you deploy a contract; run `./setup-testnet.sh` to produce them.

Each service validates its configuration at startup and **exits with a clear
message** if a required variable is missing or still holds a `.env.example`
placeholder, rather than failing later inside a query or an RPC call.

| Service    | URL                     |
| ---------- | ----------------------- |
| Frontend   | http://localhost:5173   |
| API        | http://localhost:3000   |
| Backend    | http://localhost:3001   |
| Grafana    | http://localhost:3003   |
| Prometheus | http://localhost:9090   |
| Jaeger     | http://localhost:16686  |

### 🚀 Complete Testnet Setup (Recommended)

Get up and running with testnet XLM, USDC, and a full end-to-end flow:

**Linux/macOS:**
```bash
./setup-testnet.sh
```

**Windows (PowerShell):**
```powershell
.\setup-testnet.ps1
```

This automated script will:
- Generate and fund test accounts with XLM
- Deploy SwiftRemit contract and mock USDC token
- Register agents and mint test USDC
- Run a complete test remittance flow
- Save all configuration files

**📖 For detailed instructions:** [QUICK_START.md](QUICK_START.md) | [TESTNET_SETUP_GUIDE.md](TESTNET_SETUP_GUIDE.md)

### Contract-Only Deployment

If you just need to deploy the contract:

**Linux/macOS:**
```bash
chmod +x deploy.sh
./deploy.sh testnet
```

**Windows (PowerShell):**
```powershell
.\deploy.ps1 -Network testnet
```

### Manual Setup

If you prefer to run steps manually:

### 1. Build the Contract

```bash
cd SwiftRemit
cargo build --target wasm32-unknown-unknown --release
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/swiftremit.wasm
```

### 2. Deploy to Testnet

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/swiftremit.optimized.wasm \
  --source deployer \
  --network testnet
```

### 3. Initialize

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- \
  initialize \
  --admin <ADMIN_ADDRESS> \
  --usdc_token <USDC_TOKEN_ADDRESS> \
  --fee_bps 250
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete deployment instructions.

For production readiness assessment, see [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md).

## Staging Environment

Every merge to `main` automatically triggers a deployment to the staging environment (Stellar **testnet**) via `.github/workflows/deploy-staging.yml`.

| Service  | Staging URL |
|----------|-------------|
| API      | `https://api.staging.swiftremit.io` |
| Backend  | `https://backend.staging.swiftremit.io` |
| Frontend | `https://staging.swiftremit.io` |

> **Note:** The staging URLs above are placeholders. Configure the actual URLs as GitHub Actions variables `STAGING_API_URL` and `STAGING_BACKEND_URL` in the repository's *Settings → Environments → staging*.

### How it works

1. Docker images for `backend`, `api`, and `frontend` are built and pushed to **GHCR** (`ghcr.io/<owner>/SwiftRemit/<service>:staging`).
2. The workflow SSH-es into the staging VM and runs `docker compose up -d` with the new image tags.
3. **Smoke tests** (`scripts/smoke-test-staging.sh`) run immediately after deploy to verify health and key API endpoints. The workflow fails if any check returns an unexpected status code.

### Required repository secrets / variables

| Name | Kind | Description |
|------|------|-------------|
| `STAGING_HOST` | Secret | IP or hostname of the staging VM |
| `STAGING_USER` | Secret | SSH username |
| `STAGING_SSH_KEY` | Secret | Private key for SSH access |
| `STAGING_SSH_PORT` | Secret | SSH port (default: 22) |
| `STAGING_API_URL` | Variable | Base URL for the API service |
| `STAGING_BACKEND_URL` | Variable | Base URL for the backend service |

## Environment Validation

A script checks that every env variable consumed in source code is present in the corresponding `.env.example` file. CI fails automatically if any are missing.

Run locally:

```bash
node scripts/validate-env-examples.js
```

Covers: root `.env.example`, `api/.env.example`, `backend/.env.example`, `frontend/.env.example`.

## Configuration

SwiftRemit uses environment variables for configuration. This allows you to easily configure the system for different environments (local development, testnet, mainnet) without modifying code.

### Quick Setup

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and fill in your configuration:
   ```bash
   # Required for client operations
   SWIFTREMIT_CONTRACT_ID=your_contract_id_here
   USDC_TOKEN_ID=your_usdc_token_id_here
   
   # Optional: customize other settings
   NETWORK=testnet
   DEFAULT_FEE_BPS=250
   ```

3. Your configuration is automatically loaded when running client code or deployment scripts

### Configuration Files

- **`.env`**: Your local environment configuration (gitignored, never commit this)
- **`.env.example`**: Template with all available configuration options
- **`examples/config.js`**: JavaScript configuration module that loads and validates environment variables

### Key Configuration Variables

- `NETWORK`: Network to connect to (`testnet` or `mainnet`)
- `RPC_URL`: Soroban RPC endpoint URL
- `SWIFTREMIT_CONTRACT_ID`: Deployed contract address
- `USDC_TOKEN_ID`: USDC token contract address
- `DEFAULT_FEE_BPS`: Platform fee in basis points (0-10000)
- `INITIAL_FEE_BPS`: Initial fee for contract deployment (0-10000)
- `DEPLOYER_IDENTITY`: Soroban CLI identity for deployment

### Documentation

- **[CONFIGURATION.md](CONFIGURATION.md)**: Complete configuration reference with all variables, validation rules, and examples
- **[MIGRATION.md](MIGRATION.md)**: Migration guide for existing developers
- **[RUNBOOK.md](RUNBOOK.md)**: Operational runbook — emergency pause/unpause, admin key rotation, stuck migrations, webhook replay, storage TTL extension
- **[PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md)**: Current production readiness status — what's complete, what's pending, and known risks before mainnet

## Remittance Lifecycle — Sequence Diagram

```mermaid
sequenceDiagram
    actor Sender
    actor Agent
    participant Contract as SwiftRemit Contract
    participant USDC as USDC Token
    actor Admin

    rect rgb(235, 245, 255)
        Note over Sender,Contract: Happy path — creation → settlement
        Sender->>USDC: approve(contract, amount)
        Sender->>Contract: create_remittance(agent, amount)
        Contract->>USDC: transfer(sender → escrow, amount)
        Contract-->>Sender: remittance_id (status: Pending)

        Agent->>Contract: confirm_payout(remittance_id)
        Note over Contract: Pending → Processing → Completed
        Contract->>USDC: transfer(escrow → agent, amount − fee)
        Contract-->>Agent: ok (status: Completed)
        Note over Contract: fee added to accumulated_fees
    end

    rect rgb(255, 245, 235)
        Note over Sender,Contract: Cancellation path
        Sender->>Contract: cancel_remittance(remittance_id)
        Note over Contract: Pending → Cancelled
        Contract->>USDC: transfer(escrow → sender, amount)
        Contract-->>Sender: ok (full refund)
    end

    rect rgb(240, 255, 240)
        Note over Sender,Contract: Expiry path (permissionless)
        Sender->>Contract: process_expired_remittances([id, ...])
        Note over Contract: Pending + expired → Cancelled
        Contract->>USDC: transfer(escrow → sender, amount)
        Contract-->>Sender: [processed_ids]
    end

    rect rgb(255, 235, 235)
        Note over Agent,Contract: Failed / dispute path
        Agent->>Contract: mark_failed(remittance_id)
        Note over Contract: Pending/Processing → Failed
        Sender->>Contract: raise_dispute(remittance_id, evidence_hash)
        Note over Contract: Failed → Disputed
        Admin->>Contract: resolve_dispute(remittance_id, in_favour_of_sender)
        alt in favour of sender
            Contract->>USDC: transfer(escrow → sender, amount)
            Note over Contract: Disputed → Cancelled
        else in favour of agent
            Contract->>USDC: transfer(escrow → agent, amount − fee)
            Note over Contract: Disputed → Completed
        end
    end

    rect rgb(245, 235, 255)
        Note over Admin,Contract: Fee management
        Admin->>Contract: withdraw_fees(to)
        Contract->>USDC: transfer(escrow → to, accumulated_fees)
        Contract-->>Admin: ok
    end
```

## State Machine

All remittance lifecycle state is tracked by a single canonical `RemittanceStatus` enum:

```
┌─────────┐
│ Pending │  ← initial state (funds locked in escrow)
└────┬────┘
     │
     ├──────────────────────┬──────────────────────┐
     │                      │                      │
     ▼                      ▼                      ▼
┌────────────┐        ┌───────────┐          ┌────────┐
│ Processing │        │ Cancelled │(Terminal) │ Failed │
└─────┬──────┘        └───────────┘          └───┬────┘
      │                      ▲                   │
      ├──────────────────────┤                   │
      │                      │                   ▼
      ▼                      │            ┌──────────┐
┌───────────┐                │            │ Disputed │
│ Completed │(Terminal)      │            └────┬─────┘
└───────────┘                │                 │
                             │    Cancelled ◄──┤
                             │                 │
                             └──── Completed ◄─┘
```

### Valid Transitions

| From       | To         | Trigger                        |
|------------|------------|--------------------------------|
| Pending    | Processing | Contract enters processing during `confirm_payout` |
| Pending    | Cancelled  | Sender calls `cancel_remittance` or expiry processed |
| Pending    | Failed     | Agent calls `mark_failed` |
| Processing | Completed  | `confirm_payout` completes successfully and releases USDC |
| Processing | Cancelled  | Expiry or internal failure/refund path |
| Processing | Failed     | Agent calls `mark_failed` |
| Failed     | Disputed   | Sender calls `raise_dispute` within dispute window |
| Disputed   | Cancelled  | Admin calls `resolve_dispute` in favour of sender |
| Disputed   | Completed  | Admin calls `resolve_dispute` in favour of agent |

Terminal states (`Completed`, `Cancelled`) cannot transition further. `Failed` and `Disputed` are transient — further transitions are permitted from both.



1. **Admin Setup**
   - Deploy contract
   - Initialize with admin address, USDC token, and fee percentage
   - Register trusted agents

2. **Create Remittance**
   - Sender approves USDC transfer to contract
   - Sender calls `create_remittance` with agent and amount
   - Contract transfers USDC from sender to escrow
   - Remittance ID returned for tracking (status: Pending)

3. **Agent Payout**
   - Agent pays out fiat to recipient off-chain
   - Agent calls `confirm_payout` with remittance ID
   - During `confirm_payout`, the contract moves the remittance through `Processing` and then to `Completed`
   - Contract transfers USDC minus fee to agent
   - Fee added to accumulated platform fees

4. **Alternative Flows**
   - **Early Cancellation**: Sender calls `cancel_remittance` while Pending
   - **Agent-Reported Failure**: Agent calls `mark_failed`, which refunds the escrow to the sender and sets status to `Cancelled` (see [Contract Functions](#contract-functions))

5. **Fee Management**
   - Admin monitors accumulated fees
   - Admin calls `withdraw_fees` to collect platform revenue

## Error Codes

Every error the contract can return, generated from the `ContractError` enum in
[`src/errors.rs`](src/errors.rs). Row count always equals the number of variants in that
enum — regenerate with `node scripts/generate-error-table.js --write` whenever the enum
changes (CI can run it with no `--write` and diff the output to catch drift).

<!-- ERROR_TABLE:START -->

| Code | Name | Description | Common Cause | Resolution |
| :--- | :--- | :--- | :--- | :--- |
| **1** | AlreadyInitialized | Contract already initialized | Attempting to call initialize() on an active contract. | No action required. If re-configuration is needed, check whether an admin update function exists. |
| **2** | NotInitialized | Contract not initialized | Operations attempted before the contract setup is complete. | The administrator must call initialize() with valid parameters before other functions. |
| **3** | InvalidAmount | Amount must be greater than 0 | Providing zero or negative values for a remittance. | Ensure the transfer amount is a positive integer greater than 0. |
| **4** | InvalidFeeBps | Fee must be between 0-10000 bps | Fee percentage set outside the 0-100% (0-10000 bps) range. | Adjust the basis points to fall within the valid range (e.g., 2.5% = 250 bps). |
| **5** | AgentNotRegistered | Agent not in approved list | Using an address that hasn't been added to the agent whitelist. | Register the agent address first using the register_agent function. |
| **6** | RemittanceNotFound | Remittance ID does not exist | Querying an ID that does not exist on the ledger. | Verify the remittance ID from your transaction history or event logs. |
| **7** | InvalidStatus | Operation not allowed in current status | Operation attempted while the remittance is in an incompatible state (e.g. cancelling a settled payment). | Check the current status via get_remittance before retrying. |
| **8** | InvalidStateTransition | Invalid state transition attempted | Requesting a status change that isn't reachable from the remittance's current state. | Consult the state machine diagram and only request valid transitions. |
| **9** | NoFeesToWithdraw | No accumulated fees available | Calling withdraw_fees when accumulated fees is zero. | Wait until fees accrue from settled remittances before withdrawing. |
| **10** | InvalidAddress | Invalid address format or validation failed | Address does not meet validation requirements. | Confirm the address is a valid Stellar/Soroban address before submitting. |
| **11** | SettlementExpired | Settlement window has expired | The time-lock deadline for the remittance has passed. | Cancel and recreate the remittance with a new deadline. |
| **12** | DuplicateSettlement | Settlement already executed | The payment was already claimed or processed. | Check the transaction ledger; the funds have likely already been disbursed. |
| **13** | ContractPaused | Contract is paused; settlements temporarily disabled | Circuit breaker active due to maintenance or emergency. | Monitor the project's status channels and wait for an admin to unpause. |
| **14** | AssetNotFound | Asset verification record not found | Querying verification data for an asset that hasn't been submitted for verification. | Submit the asset for verification before querying its status. |
| **15** | UserBlacklisted | User is blacklisted and cannot perform transactions | The user's address is on the blacklist. | Contact an administrator to review and potentially remove the blacklist entry. |
| **16** | InvalidReputationScore | Reputation score must be between 0 and 100 | Supplying a reputation score outside the 0-100 range. | Pass a value between 0 and 100 inclusive. |
| **17** | KycNotApproved | User KYC is not approved | User has not completed KYC verification. | Complete the KYC flow with an approved provider before transacting. |
| **18** | SuspiciousAsset | Asset has been flagged as suspicious | The asset failed one or more verification/reputation checks. | Review the asset's verification report; do not proceed without an admin override. |
| **19** | AnchorTransactionFailed | Anchor withdrawal/deposit operation failed | The SEP-24 anchor rejected or failed to process the operation. | Check the anchor's status and retry, or contact anchor support. |
| **20** | Unauthorized | Caller is not authorized to perform this operation | Non-admin or non-owner attempting an admin/owner-only operation. | Call the function using an authorized admin or owner address. |
| **21** | DailySendLimitExceeded | User's daily send limit exceeded | User's total transfers in the last 24 hours exceed the configured limit. | Wait for the rolling 24-hour window to reset or request a limit increase. |
| **22** | TokenAlreadyWhitelisted | Token is already whitelisted | Attempting to add a token that is already whitelisted. | No action required; verify with get_whitelisted_tokens. |
| **23** | KycExpired | User KYC has expired and needs renewal | The user's KYC verification has passed its expiry timestamp. | Re-submit KYC verification with the provider. |
| **24** | TransactionNotFound | Transaction record not found | Querying a transaction ID that doesn't exist. | Verify the transaction ID from event logs or the indexer. |
| **25** | RateLimitExceeded | Rate limit exceeded | Caller exceeded the configured number of operations in the current window. | Wait for the rate-limit window to reset before retrying. |
| **26** | AdminAlreadyExists | Admin address already registered | Attempting to add an admin that is already registered. | No action required; verify with get_admins. |
| **27** | AdminNotFound | Admin address not found | Attempting to remove or reference an admin that isn't registered. | Verify the admin address with get_admins before retrying. |
| **28** | CannotRemoveLastAdmin | Cannot remove the last admin | Attempting to remove the only remaining admin, which would leave the contract without governance. | Add a new admin before removing the existing one. |
| **29** | TokenNotWhitelisted | Token is not whitelisted | Attempting to initialize or transact with a non-whitelisted token. | Whitelist the token first or use an already-approved token. |
| **30** | InvalidMigrationHash | Migration hash verification failed | Snapshot hash doesn't match the computed hash (data tampering or corruption). | Re-export the migration snapshot and verify its integrity before retrying. |
| **31** | MigrationInProgress | Migration already in progress or completed | Attempting to start a migration when one is already active. | Wait for the current migration to finish, or check migration status. |
| **32** | InvalidMigrationBatch | Migration batch out of order or invalid | Importing batches in the wrong order or with an invalid batch number. | Import migration batches sequentially, starting from batch 0. |
| **33** | CooldownActive | Cooldown period is still active | Attempting an action before its cooldown period has elapsed. | Wait for the cooldown timer to expire before retrying. |
| **34** | SuspiciousActivity | Suspicious activity detected | Pattern matching known abuse behaviors (rapid retries, unusual patterns). | Reduce request frequency; contact support if this persists unexpectedly. |
| **35** | ActionBlocked | Action temporarily blocked due to abuse protection | Multiple violations or severe abuse detected from the caller. | Wait for the block to lift or contact an administrator to review the flag. |
| **36** | Overflow | Arithmetic overflow detected | Result of an arithmetic operation exceeds the maximum representable value. | Reduce the input amount(s); check for unreasonably large values. |
| **37** | NetSettlementValidationFailed | Net settlement validation failed | Net settlement calculations don't match expected values. | Recompute the netting batch inputs and resubmit. |
| **38** | EscrowNotFound | Escrow record not found | Querying an escrow ID that doesn't exist. | Verify the escrow ID from creation events before retrying. |
| **39** | InvalidEscrowStatus | Invalid escrow status for this operation | Attempting an operation on an escrow in an incompatible status. | Check the escrow's current status via get_escrow before retrying. |
| **40** | SettlementCounterOverflow | Settlement counter overflow | The global settlement counter would exceed u64::MAX. | Contact the maintainers; this indicates the contract needs a counter migration. |
| **41** | InvalidBatchSize | Invalid batch size for batch operations | Provided batch size is zero or exceeds the configured maximum. | Split the request into batches within the allowed size limit. |
| **42** | DataCorruption | Data corruption detected in stored values | Integrity checks failed on stored contract data. | Contact the maintainers; do not retry writes until the root cause is investigated. |
| **43** | IndexOutOfBounds | Index out of bounds | Accessing a collection with an index outside its valid range. | Verify the collection length before indexing into it. |
| **44** | EmptyCollection | Collection is empty | The requested operation requires at least one element but the collection is empty. | Ensure the collection is populated before calling this operation. |
| **45** | KeyNotFound | Key not found in map | Lookup failed for a required key in a storage map. | Verify the key exists via the corresponding getter before use. |
| **46** | StringConversionFailed | String conversion failed | Invalid or malformed input during string conversion. | Check the input encoding and length before submitting. |
| **47** | InvalidSymbol | Invalid or malformed symbol string | Symbol exceeds length limits or contains invalid characters. | Use a short, alphanumeric symbol consistent with Soroban's Symbol type. |
| **48** | Underflow | Arithmetic underflow occurred | Result of an arithmetic operation is below the minimum representable value (e.g., subtracting more than available). | Verify balances/amounts before performing the subtraction. |
| **49** | NoPendingAdminTransfer | No pending admin transfer to accept | accept_admin() called when no propose_admin() has been issued. | Have the current admin call propose_admin() first. |
| **50** | IdempotencyConflict | Idempotency key conflict with different payload | The same idempotency key was reused with a different request payload. | Use a new idempotency key for a differing request, or resend the exact original payload. |
| **51** | InvalidProof | Proof validation failed | The submitted proof does not match the expected commitment. | Regenerate the proof from the correct source data and resubmit. |
| **52** | MissingProof | Proof is required but not provided | Calling a function that requires a proof without supplying one. | Include the required proof parameter in the call. |
| **53** | InvalidOracleAddress | Oracle address is invalid or not configured | The configured oracle address is unset or fails validation. | Configure a valid oracle address via the admin function before use. |
| **54** | AlreadyPaused | Contract is already paused | Calling emergency_pause when the contract is already in a paused state. | No action required; verify with is_paused before pausing again. |
| **55** | NotPaused | Contract is not currently paused | Calling an unpause or paused-only function while the contract is active. | Verify the contract's paused state with is_paused before calling. |
| **56** | OperationNotFound | Pending admin operation not found | Referencing a multi-sig operation ID that doesn't exist or already executed. | Verify the operation ID from the proposal event before approving. |
| **57** | AlreadyApproved | Caller has already approved this pending operation | The same admin calling approve_operation twice for the same operation. | No action required; wait for other admins to approve. |
| **58** | OperationExpired | Pending operation has exceeded its time-to-live | The operation's TTL elapsed before reaching the required approval threshold. | Re-propose the operation to restart the approval window. |
| **59** | InvalidMultiSigThreshold | Multi-sig threshold must be at least 1 and no greater than the admin count | Setting a threshold of 0 or greater than the current admin count. | Choose a threshold between 1 and the current number of admins. |
| **60** | AlreadyAdmin | Address is already in the admin set | Attempting to add an address that is already an admin. | No action required; verify with get_admins. |
| **61** | InsufficientAdmins | Removing this admin would drop the admin count below quorum or below 1 | The remaining admin count after removal would violate the quorum requirement. | Add another admin or lower the quorum before removing this one. |
| **62** | InvalidQuorum | Quorum must be >= 1 and <= current admin count | Setting a quorum of 0 or greater than the current admin count. | Choose a quorum value within the valid range for the current admin set. |
| **63** | AlreadyVoted | Admin has already cast a vote on this proposal | The same admin calling vote() twice on the same proposal. | No action required; wait for other admins to vote. |
| **64** | InvalidProposalState | Proposal is not in the required state for this operation | Attempting to vote on, execute, or cancel a proposal that isn't in the expected lifecycle state. | Check the proposal's current state via get_proposal before retrying. |
| **65** | ProposalAlreadyPending | A fee-update proposal is already pending or approved | Attempting to create a new fee-update proposal while one is still active. | Wait for the pending proposal to execute or be cancelled first. |
| **66** | TimelockActive | Proposal timelock has not elapsed | Attempting to execute a proposal before its timelock period has passed. | Wait until the timelock expires before executing the proposal. |
| **67** | GovernanceAlreadyInitialized | Governance has already been initialized | Calling migrate_to_governance more than once. | No action required; governance is already active. |
| **68** | ProposalNotFound | Proposal with the given ID does not exist | Querying or voting on a proposal ID that was never created. | Verify the proposal ID from the creation event before retrying. |
| **69** | AgentAlreadyRegistered | Agent is already registered in the system | Attempting to register an agent address that's already on the whitelist. | No action required; verify with get_agent. |
| **71** | NotDisputed | This operation requires the remittance to be in a Disputed state | Calling a dispute-resolution function on a remittance that hasn't been disputed. | Call raise_dispute first, or verify the remittance status. |
| **83** | MalformedEvidenceHash | Evidence hash for a dispute is not a valid 32-byte SHA-256 commitment | Supplying an evidence hash that isn't exactly 32 bytes. | Compute a SHA-256 hash of the evidence and pass the raw 32-byte digest. |

<!-- ERROR_TABLE:END -->

## Events

The contract emits events for monitoring. See [`docs/EVENTS.md`](docs/EVENTS.md) for the
full catalogue — every emit function in `src/events.rs`, its topics, payload shape, and
schema version. A few of the most common:

- `created` - New remittance created
- `completed` - Payout confirmed and settled
- `cancelled` - Remittance cancelled by sender
- `agent_reg` - Agent registered
- `agent_rem` - Agent removed
- `fee_upd` - Platform fee updated
- `fees_with` - Fees withdrawn by admin

## Dependencies

- `soroban-sdk = "26.1.0"` - pinned in [`Cargo.toml`](Cargo.toml), which is the source of truth if this drifts

## License

MIT — see [LICENSE](LICENSE) for the full text.

Every package manifest in the repository (`package.json`, `Cargo.toml`) declares
`MIT`, and CI rejects any dependency whose licence cannot be redistributed under
MIT. Run the checks locally with:

```bash
node scripts/check-manifest-licenses.js     # LICENSE present, manifests declare MIT
node scripts/check-dependency-licenses.js   # npm dependency licences
cargo deny --all-features check licenses    # Rust dependency licences (see deny.toml)
```

## Support

For issues and questions:
- GitHub Issues: [Create an issue](https://github.com/yourusername/swiftremit/issues)
- Stellar Discord: https://discord.gg/stellar
- Documentation: See [DEPLOYMENT.md](DEPLOYMENT.md)

## Contributing

Contributions are welcome! We appreciate your help in making SwiftRemit better.

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines on:
- Setting up your development environment
- Coding standards and best practices
- Running tests locally
- Submitting pull requests
- Creating issues

Quick checklist:
- All tests pass: `cargo test`
- Code follows project style guidelines
- New features include tests
- Documentation is updated

## Asset Verification System

SwiftRemit now includes a comprehensive asset verification system that validates Stellar assets against multiple trusted sources. See [ASSET_VERIFICATION.md](ASSET_VERIFICATION.md) for complete documentation.

### Features

- ✅ Multi-source verification (Stellar Expert, TOML, trustlines, transaction history)
- ✅ On-chain storage of verification results
- ✅ RESTful API for verification queries
- ✅ React component for visual trust indicators
- ✅ Background job for periodic revalidation
- ✅ Community reporting system
- ✅ Reputation scoring (0-100)
- ✅ Suspicious asset detection and warnings

### Quick Start

```bash
# Start backend service
cd backend
npm install
cp .env.example .env
npm run dev

# Use in React
import { VerificationBadge } from './components/VerificationBadge';

<VerificationBadge assetCode="USDC" issuer="GA5Z..." />
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for shipped features (with links to the implementing code)
and genuinely pending work.

