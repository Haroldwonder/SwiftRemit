# SwiftRemit Contract Migration Guide

This document covers two distinct migration scenarios:

1. **In-place WASM upgrade** — the contract address stays the same; only the
   bytecode changes.  Call `migrate()` immediately after the upgrade.
2. **Cross-contract migration** — state is moved from one deployed contract
   instance to a freshly deployed one using `export_migration_snapshot` /
   `import_migration_batch`.

---

## Part 1 — In-Place WASM Upgrade Migration

### Background: Why Agent Keys Are at Risk

Soroban persistent storage keys are XDR-encoded `contracttype` enum variants.
When a contract is upgraded via `env.deployer().update_current_contract_wasm()`,
the new bytecode is live immediately but **all existing storage entries remain
unchanged**.  If the new code changes the discriminant, field order, or type of
any `DataKey` variant, the old entries become unreadable — effectively orphaned.

The following persistent keys are written per-agent and are at risk:

| `DataKey` variant              | Value type        | Risk                                                  |
|-------------------------------|-------------------|-------------------------------------------------------|
| `AgentRegistered(Address)`    | `bool`            | Orphaned if variant discriminant or Address XDR changes |
| `AgentKycHash(Address)`       | `BytesN<32>`      | Orphaned if variant discriminant changes              |
| `AgentStats(Address)`         | `AgentStats`      | Orphaned if `AgentStats` struct layout changes        |
| `AgentDailyCap(Address)`      | `i128`            | Orphaned if variant discriminant changes              |
| `AgentWithdrawals(Address)`   | `Vec<TransferRecord>` | Orphaned if `TransferRecord` layout changes       |
| `RoleAssignment(Addr, Role)`  | `bool`            | Orphaned if `Role` enum repr changes                  |
| `AgentList`                   | `Vec<Address>`    | **Was missing in schema v1** — must be rebuilt        |

### Why Keys Are Not Automatically Migrated

Soroban does not provide a built-in key-rename or schema-migration primitive.
The runtime simply reads raw XDR bytes from the ledger using the key produced
by the current code.  If the key encoding changed, the lookup returns `None`.

Additionally, there is no way to iterate all persistent storage entries from
within a contract — you can only read a key if you already know it.  This is
why the `AgentList` index is critical: it is the only way to enumerate all
registered agents so their keys can be re-written after an upgrade.

### Assumptions

1. The `AgentList` persistent key is kept in sync with `AgentRegistered` by
   `set_agent_registered()` (enforced since schema v2).
2. On a v1 contract (deployed before this fix), `AgentList` may be empty.
   In that case the admin must supply the list of known agent addresses
   out-of-band before calling `migrate()`.
3. `AgentStats`, `AgentDailyCap`, and `AgentWithdrawals` are performance /
   rate-limit data.  Loss of these values degrades analytics but does not
   affect fund safety.  They are **not** re-written by `migrate()` in v2
   because their `DataKey` variants were not changed.  Add a v3 step if
   their layout changes in a future upgrade.

---

## In-Place Upgrade: Step-by-Step

### 1. Verify the current schema version (optional)

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  -- get_schema_version
```

If the output is already `2` (or `CURRENT_SCHEMA_VERSION`), no migration is
needed.

### 2. Upgrade the WASM

```bash
soroban contract install --wasm target/wasm32-unknown-unknown/release/swiftremit.wasm
# Note the new WASM hash printed above, e.g. abc123...

soroban contract invoke \
  --id <CONTRACT_ID> \
  -- upgrade \
  --caller <ADMIN_ADDRESS> \
  --new_wasm_hash <NEW_WASM_HASH>
```

### 3. Call `migrate()` immediately after the upgrade

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  -- migrate \
  --caller <ADMIN_ADDRESS>
```

`migrate()` is **idempotent** — calling it a second time is a no-op.

### 4. Verify agent records are intact

```bash
soroban contract invoke --id <CONTRACT_ID> -- is_agent_registered --agent <AGENT_ADDRESS>
```

Repeat for a representative sample of agents.

### 5. Rollback (if validation failed)

If `migrate()` returned `MigrationValidationFailed`:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  -- rollback_migration \
  --caller <ADMIN_ADDRESS>
```

This restores all agent registration records from the pre-migration snapshot
that was saved at the start of `migrate()`.

---

## Part 2 — Cross-Contract Migration

Use this path when deploying a new contract address (e.g., after a breaking
change that requires a fresh deployment).

### Prerequisites

- Admin role on both source and destination contracts.
- Destination contract already initialized (`initialize` called).

### Step 1 — Initialize the destination contract

```bash
soroban contract invoke \
  --id <DEST_CONTRACT_ID> \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --usdc_token <USDC_TOKEN_ADDRESS> \
  --fee_bps 250 \
  --rate_limit_cooldown 3600 \
  --protocol_fee_bps 0 \
  --treasury <TREASURY_ADDRESS>
```

### Step 2 — Export the snapshot from the source contract

```bash
soroban contract invoke \
  --id <SOURCE_CONTRACT_ID> \
  -- export_migration_snapshot \
  --caller <ADMIN_ADDRESS>
```

Save the returned `MigrationSnapshot` JSON.  The source contract is now
**locked** — `create_remittance` and `confirm_payout` return `MigrationInProgress`.

The snapshot now includes **full agent records** (`AgentRecord` with `address`,
`registered`, and `kyc_hash`), not just addresses.

### Step 3 — Split into batches and import

Split `MigrationSnapshot.persistent_data.remittances` into chunks of at most
`MAX_MIGRATION_BATCH_SIZE` (100) items.  Batches **must** be submitted in strict
sequential order starting from `batch_number = 0`.  Submitting a batch whose
`batch_number` does not equal the next expected index returns
`InvalidMigrationBatch` (32) and leaves the destination contract in its current
state — no partial write occurs.

For each chunk:

```bash
soroban contract invoke \
  --id <DEST_CONTRACT_ID> \
  -- import_migration_batch \
  --caller <ADMIN_ADDRESS> \
  --batch '{ "batch_number": 0, "total_batches": N, "remittances": [...], "batch_hash": "..." }'
```

After the final batch the destination contract automatically clears the
`MigrationInProgress` flag.

### Step 3a — Abort a failed import (rollback)

If an import fails mid-way (e.g. a batch hash mismatch, out-of-order batch, or
off-chain tooling error), call `abort_migration` on the **destination** contract
to reset the state machine back to Idle:

```bash
soroban contract invoke \
  --id <DEST_CONTRACT_ID> \
  -- abort_migration \
  --caller <ADMIN_ADDRESS>
```

`abort_migration`:
- Clears the `MigrationInProgress` flag (re-enables normal operations).
- Resets the batch ordering counter so a fresh import can start from batch 0.
- Emits a `migration_aborted` event for off-chain indexers.

> **Note:** Any remittances already written by previous `import_migration_batch`
> calls are **not** automatically removed.  If a clean slate is required,
> re-initialize the destination contract before retrying the import.

### Step 4 — Verify

```bash
soroban contract invoke --id <DEST_CONTRACT_ID> -- get_remittance --remittance_id 1
soroban contract invoke --id <DEST_CONTRACT_ID> -- is_agent_registered --agent <AGENT_ADDRESS>
```

### Step 5 — Redirect traffic

Update off-chain services to point to `<DEST_CONTRACT_ID>`.

---

## Error Reference

| Error                       | Code | Meaning                                                    |
|-----------------------------|------|------------------------------------------------------------|
| `MigrationInProgress`       | 31   | Export already called; or normal op blocked during migration |
| `InvalidMigrationHash`      | 30   | Batch hash mismatch — data was tampered or corrupted       |
| `InvalidMigrationBatch`     | 32   | `batch_number != expected_next_batch` or `batch_number >= total_batches` |
| `MigrationValidationFailed` | 56   | One or more agents unreadable after `migrate()`            |
| `NotFound`                  | 57   | No rollback snapshot exists; or `abort_migration` called when not in progress |
| `Unauthorized`              | 20   | Caller does not have Admin role                            |

---

## Security Notes

- The `verification_hash` in `MigrationSnapshot` covers all instance and
  persistent data plus the timestamp and ledger sequence.  Any tampering will
  cause `InvalidMigrationHash` on import.
- Each `MigrationBatch` carries its own `batch_hash` verified independently.
- `migrate()` saves a `RollbackSnapshot` to instance storage before making any
  writes.  The snapshot is cleared only after successful validation.
- The source contract stays locked until you explicitly clear the flag (or
  redeploy), preventing new state from being created after the snapshot.
