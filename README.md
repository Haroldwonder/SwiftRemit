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

### Administrative Functions

- `initialize(admin, usdc_token, fee_bps)` - One-time contract initialization
- `register_agent(agent)` - Add agent to approved list (admin only)
- `remove_agent(agent)` - Remove agent from approved list (admin only)
- `update_fee(fee_bps)` - Update platform fee percentage (admin only)
- `set_daily_limit(currency, country, limit)` - Configure sender limits by corridor (admin only)
- `withdraw_fees(to)` - Withdraw accumulated platform fees (admin only)
- `withdraw_integrator_fees(integrator, to)` - Withdraw accumulated integrator fees (integrator auth required)

### User Functions

- `create_remittance(sender, agent, amount)` - Create new remittance (sender auth required)
- `start_processing(remittance_id)` - Mark remittance as being processed (agent auth required)
- `confirm_payout(remittance_id, proof)` - Confirm fiat payout with optional commitment proof
- `confirm_partial_payout(remittance_id, amount)` - Disburse a partial amount to the agent; automatically marks the remittance Completed when the total disbursed reaches the net payout (agent auth required)
- `mark_failed(remittance_id)` - Mark payout as failed and auto-refund escrow to sender (agent auth required)
- `cancel_remittance(remittance_id)` - Cancel pending remittance (sender auth required)
- `process_expired_remittances(remittance_ids)` - Auto-refund expired pending remittances in batches (max 50 IDs)

### Query Functions

- `get_remittance(remittance_id)` - Retrieve remittance details
- `get_accumulated_fees()` - Check total platform fees collected
- `is_agent_registered(agent)` - Verify agent registration status
- `is_token_whitelisted(token)` - Check whether a token is currently accepted
- `get_admin_count()` - Read the number of registered admins
- `get_platform_fee_bps()` - Get current fee percentage
- `get_rate_limit_status(address)` - Read current rate-limit usage for an address
- `get_daily_limit(currency, country)` - Read configured daily send limit for a corridor
- `get_remittance_count()` - Total number of remittances ever created
- `get_total_volume()` - Cumulative volume of all completed remittances (original amounts)
- `health()` - On-chain health check: initialized, paused, admin_count, total_remittances, accumulated_fees

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
   - There is no separate public `start_processing` or `mark_failed` function in the current contract API

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

- `soroban-sdk = "25.3.1"` - Latest Soroban SDK

## License

MIT

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

