//! Migration module for SwiftRemit contract upgrades.
//!
//! # Overview
//!
//! This module handles two distinct migration scenarios:
//!
//! 1. **Cross-contract migration** (`export_state` / `import_batch`): moves all state
//!    from one deployed contract instance to a freshly deployed one.
//!
//! 2. **In-place WASM upgrade migration** (`migrate`): called immediately after
//!    `env.deployer().update_current_contract_wasm(new_hash)` to rewrite any
//!    storage keys whose layout changed between contract versions.
//!
//! # Agent Registration Keys at Risk
//!
//! The following persistent storage keys are written per-agent and are **not**
//! automatically carried over during a WASM upgrade:
//!
//! | DataKey variant              | Type          | Risk                                      |
//! |------------------------------|---------------|-------------------------------------------|
//! | `AgentRegistered(Address)`   | `bool`        | Orphaned if key layout changes            |
//! | `AgentKycHash(Address)`      | `BytesN<32>`  | Orphaned if key layout changes            |
//! | `AgentStats(Address)`        | `AgentStats`  | Orphaned if key layout changes            |
//! | `AgentDailyCap(Address)`     | `i128`        | Orphaned if key layout changes            |
//! | `AgentWithdrawals(Address)`  | `Vec<…>`      | Orphaned if key layout changes            |
//! | `RoleAssignment(Addr,Role)`  | `bool`        | Orphaned if Role enum repr changes        |
//! | `AgentList`                  | `Vec<Address>`| Must exist for iteration to work          |
//!
//! The `AgentList` persistent key is the **registry index** that makes all other
//! per-agent keys iterable.  Without it, agents cannot be enumerated and their
//! data cannot be migrated.
//!
//! # Idempotency
//!
//! `migrate()` is safe to call more than once.  It checks a `MigrationVersion`
//! instance key and skips work that has already been done.

use soroban_sdk::{contracttype, Address, Bytes, BytesN, Env, Vec, xdr::ToXdr};

use crate::{config::MAX_MIGRATION_BATCH_SIZE, ContractError, Remittance, RemittanceStatus};

// ─── Schema version ──────────────────────────────────────────────────────────

/// Current on-chain schema version.  Bump this whenever a storage key layout
/// changes that requires a `migrate()` pass.
pub const CURRENT_SCHEMA_VERSION: u32 = 2;

// ─── Types ───────────────────────────────────────────────────────────────────

/// Full agent registration record captured during export / rollback snapshot.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AgentRecord {
    /// The agent's Stellar address.
    pub address: Address,
    /// Whether the agent is currently active.
    pub registered: bool,
    /// Optional KYC metadata hash (32-byte SHA-256 of off-chain KYC document).
    pub kyc_hash: Option<BytesN<32>>,
}

/// Migration state snapshot containing all contract data.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MigrationSnapshot {
    /// Schema version for forward compatibility.
    pub version: u32,
    /// Timestamp when snapshot was created.
    pub timestamp: u64,
    /// Ledger sequence when snapshot was created.
    pub ledger_sequence: u32,
    /// Instance storage data.
    pub instance_data: InstanceData,
    /// Persistent storage data.
    pub persistent_data: PersistentData,
    /// Cryptographic hash of all data for integrity verification.
    pub verification_hash: BytesN<32>,
}

/// Instance storage data (contract-level configuration).
#[contracttype]
#[derive(Clone, Debug)]
pub struct InstanceData {
    pub admin: Address,
    pub usdc_token: Address,
    pub platform_fee_bps: u32,
    pub remittance_counter: u64,
    pub accumulated_fees: i128,
    pub paused: bool,
    pub admin_count: u32,
}

/// Persistent storage data (per-entity data).
#[contracttype]
#[derive(Clone, Debug)]
pub struct PersistentData {
    /// All remittances indexed by ID.
    pub remittances: Vec<Remittance>,
    /// Full agent records (address + registered flag + kyc_hash).
    pub agents: Vec<AgentRecord>,
    /// Admin role addresses.
    pub admin_roles: Vec<Address>,
    /// Remittance IDs that have been settled (for dedup).
    pub settlement_hashes: Vec<u64>,
    /// Whitelisted token addresses.
    pub whitelisted_tokens: Vec<Address>,
}

/// Migration batch for incremental export/import.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MigrationBatch {
    pub batch_number: u32,
    pub total_batches: u32,
    pub remittances: Vec<Remittance>,
    pub batch_hash: BytesN<32>,
}

/// Migration verification result.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MigrationVerification {
    pub valid: bool,
    pub expected_hash: BytesN<32>,
    pub actual_hash: BytesN<32>,
    pub timestamp: u64,
}

/// Pre-migration rollback snapshot stored in instance storage.
///
/// Captured by `migrate()` before any writes so the state can be restored
/// if validation fails.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RollbackSnapshot {
    /// Schema version that was active before the migration.
    pub from_version: u32,
    /// Ledger sequence when the snapshot was taken.
    pub ledger_sequence: u32,
    /// All agent records at the time of snapshot.
    pub agents: Vec<AgentRecord>,
}

// ─── Instance key for schema version ─────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum MigrationKey {
    /// Stores the u32 schema version that has been applied.
    SchemaVersion,
    /// Stores a `RollbackSnapshot` taken before the last `migrate()` run.
    RollbackSnapshot,
    /// Tracks the next expected batch index during a cross-contract import.
    ExpectedNextBatch,
    /// Tracks whether a cross-contract migration is in progress.
    /// Blocks normal operations until migration completes successfully.
    MigrationInProgress,
}

fn get_schema_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&MigrationKey::SchemaVersion)
        .unwrap_or(1) // contracts deployed before versioning default to v1
}

fn set_schema_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&MigrationKey::SchemaVersion, &version);
}

fn save_rollback_snapshot(env: &Env, snapshot: &RollbackSnapshot) {
    env.storage()
        .instance()
        .set(&MigrationKey::RollbackSnapshot, snapshot);
}

fn load_rollback_snapshot(env: &Env) -> Option<RollbackSnapshot> {
    env.storage()
        .instance()
        .get(&MigrationKey::RollbackSnapshot)
}

fn clear_rollback_snapshot(env: &Env) {
    env.storage()
        .instance()
        .remove(&MigrationKey::RollbackSnapshot);
}

// ─── Batch ordering helpers ───────────────────────────────────────────────────

fn get_expected_next_batch(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&MigrationKey::ExpectedNextBatch)
        .unwrap_or(0u32)
}

fn set_expected_next_batch(env: &Env, next: u32) {
    env.storage()
        .instance()
        .set(&MigrationKey::ExpectedNextBatch, &next);
}

fn clear_expected_next_batch(env: &Env) {
    env.storage()
        .instance()
        .remove(&MigrationKey::ExpectedNextBatch);
}

// ─── Migration state helpers ──────────────────────────────────────────────────

fn is_migration_in_progress(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&MigrationKey::MigrationInProgress)
        .unwrap_or(false)
}

fn set_migration_in_progress(env: &Env, in_progress: bool) {
    if in_progress {
        env.storage()
            .instance()
            .set(&MigrationKey::MigrationInProgress, &true);
    } else {
        env.storage()
            .instance()
            .remove(&MigrationKey::MigrationInProgress);
    }
}

// ─── Helper: status byte ─────────────────────────────────────────────────────

fn status_to_byte(status: &RemittanceStatus) -> u8 {
    match status {
        RemittanceStatus::Pending => 0,
        RemittanceStatus::Processing => 1,
        RemittanceStatus::Completed => 2,
        RemittanceStatus::Cancelled => 3,
        RemittanceStatus::Failed => 4,
        RemittanceStatus::Disputed => 5,
    }
}

// ─── Public migration state query ─────────────────────────────────────────────

/// Check if a cross-contract migration is currently in progress.
///
/// Returns `true` if `import_batch` has been called for the first batch but
/// not yet completed for the final batch. During this period, normal contract
/// operations should be blocked to prevent data inconsistency.
pub fn is_migration_in_progress_public(env: &Env) -> bool {
    is_migration_in_progress(env)
}

// ─── migrate() — in-place WASM upgrade entrypoint ────────────────────────────

/// Migrate persistent storage keys after an in-place WASM upgrade.
///
/// This function **must** be called as the first operation after
/// `env.deployer().update_current_contract_wasm(new_hash)` completes.
///
/// # What it does
///
/// 1. Reads the current `SchemaVersion` from instance storage.
/// 2. If already at `CURRENT_SCHEMA_VERSION`, returns `Ok(())` immediately
///    (idempotent — safe to call multiple times).
/// 3. Captures a `RollbackSnapshot` of all agent registration data.
/// 4. Runs each pending migration step in order.
/// 5. Validates that all agents in the snapshot are still readable after migration.
/// 6. Bumps `SchemaVersion` to `CURRENT_SCHEMA_VERSION`.
/// 7. Clears the rollback snapshot on success.
///
/// # Rollback
///
/// If validation fails, call `rollback_migration()` to restore the pre-migration
/// agent state from the saved `RollbackSnapshot`.
///
/// # Authorization
///
/// Caller must be an admin.  Auth is enforced at the call site in `lib.rs`.
///
/// # Errors
///
/// - `ContractError::MigrationValidationFailed` — one or more agents could not
///   be read back after migration.
pub fn migrate(env: &Env) -> Result<(), ContractError> {
    let current_version = get_schema_version(env);

    // Idempotency guard — nothing to do if already current.
    if current_version >= CURRENT_SCHEMA_VERSION {
        return Ok(());
    }

    // ── Step 1: capture rollback snapshot ────────────────────────────────────
    let agent_list = crate::storage::get_admin_list(env);
    let mut snapshot_agents: Vec<AgentRecord> = Vec::new(env);

    for i in 0..agent_list.len() {
        let addr = agent_list.get_unchecked(i);
        let registered = crate::storage::is_agent_registered(env, &addr);
        let kyc_hash = crate::storage::get_agent_kyc_hash(env, &addr);
        snapshot_agents.push_back(AgentRecord {
            address: addr,
            registered,
            kyc_hash,
        });
    }

    let rollback = RollbackSnapshot {
        from_version: current_version,
        ledger_sequence: env.ledger().sequence(),
        agents: snapshot_agents.clone(),
    };
    save_rollback_snapshot(env, &rollback);

    // ── Step 2: run version-specific migration steps ─────────────────────────
    if current_version < 2 {
        migrate_v1_to_v2(env, &snapshot_agents)?;
    }
    // Future: if current_version < 3 { migrate_v2_to_v3(env)?; }

    // ── Step 3: validate — every agent in the snapshot must still be readable ─
    let mut failed_count: u32 = 0;
    for i in 0..snapshot_agents.len() {
        let record = snapshot_agents.get_unchecked(i);
        let readable = crate::storage::is_agent_registered(env, &record.address);
        // An agent that was registered before must still be registered after.
        if record.registered && !readable {
            failed_count += 1;
            // Emit a diagnostic event so off-chain tooling can identify the orphan.
            env.events().publish(
                (soroban_sdk::symbol_short!("mig_fail"), record.address.clone()),
                soroban_sdk::symbol_short!("not_found"),
            );
        }
    }

    if failed_count > 0 {
        // Do NOT bump the version — leave rollback snapshot in place.
        return Err(ContractError::MigrationValidationFailed);
    }

    // ── Step 4: commit ────────────────────────────────────────────────────────
    set_schema_version(env, CURRENT_SCHEMA_VERSION);
    clear_rollback_snapshot(env);

    env.events().publish(
        (soroban_sdk::symbol_short!("migrated"),),
        CURRENT_SCHEMA_VERSION,
    );

    Ok(())
}

/// v1 → v2: Ensure the `AgentList` index is populated.
///
/// In schema v1 the `AgentList` key did not exist.  Agents were registered via
/// `AgentRegistered(Address)` but there was no way to iterate them.  This step
/// rebuilds the index from the snapshot captured before the migration.
///
/// Assumption: the caller has already built `snapshot_agents` by reading
/// `AgentRegistered` for every known agent address.  If an agent address is not
/// in the snapshot it will not appear in the rebuilt index — this is acceptable
/// because the snapshot is built from the existing `AgentList` (which may be
/// empty on v1 contracts) combined with any agents passed in by the admin.
fn migrate_v1_to_v2(env: &Env, agents: &Vec<AgentRecord>) -> Result<(), ContractError> {
    for i in 0..agents.len() {
        let record = agents.get_unchecked(i);

        // Re-write registration flag under the current schema's XDR encoding.
        crate::storage::set_agent_registered(env, &record.address, record.registered);

        // Re-write KYC hash if present.
        if let Some(ref hash) = record.kyc_hash {
            crate::storage::set_agent_kyc_hash(env, &record.address, hash);
        }
        // set_agent_registered already calls add_agent_to_list / remove_agent_from_list,
        // so the AgentList index is rebuilt automatically.
    }
    Ok(())
}

/// Restore agent registration state from the rollback snapshot.
///
/// Call this if `migrate()` returned `MigrationValidationFailed` or if
/// post-migration smoke tests reveal data loss.
///
/// # Authorization
///
/// Caller must be an admin.  Auth is enforced at the call site in `lib.rs`.
///
/// # Errors
///
/// - `ContractError::NotFound` — no rollback snapshot exists (migration was
///   never started or was already committed successfully).
pub fn rollback_migration(env: &Env) -> Result<(), ContractError> {
    let snapshot = load_rollback_snapshot(env).ok_or(ContractError::NotFound)?;

    // Restore every agent record from the snapshot.
    for i in 0..snapshot.agents.len() {
        let record = snapshot.agents.get_unchecked(i);
        crate::storage::set_agent_registered(env, &record.address, record.registered);
        if let Some(ref hash) = record.kyc_hash {
            crate::storage::set_agent_kyc_hash(env, &record.address, hash);
        }
    }

    // Restore the schema version to what it was before the migration attempt.
    set_schema_version(env, snapshot.from_version);

    // Clear the snapshot — rollback is a one-shot operation.
    clear_rollback_snapshot(env);

    env.events().publish(
        (soroban_sdk::symbol_short!("rolled_ba"),),
        snapshot.from_version,
    );

    Ok(())
}

/// Aborts an in-progress cross-contract migration and resets the state machine to Idle.
///
/// Clears the `MigrationInProgress` flag, resets the batch ordering counter, and
/// emits a `migration_aborted` event so off-chain indexers can detect the rollback.
/// Any partially imported data written by previous `import_migration_batch` calls
/// is **not** automatically removed — the destination contract should be considered
/// dirty and re-initialized if a clean slate is required.
///
/// # Authorization
/// Caller must be an admin. Auth is enforced at the call site in `lib.rs`.
///
/// # Errors
/// - `ContractError::NotFound` — no migration is currently in progress.
pub fn abort_migration(env: &Env, caller: &Address) -> Result<(), ContractError> {
    if !crate::storage::is_migration_in_progress(env) {
        return Err(ContractError::NotFound);
    }

    // Reset state machine to Idle.
    crate::storage::set_migration_in_progress(env, false);

    // Reset batch ordering counter.
    clear_expected_next_batch(env);

    env.events().publish(
        (soroban_sdk::Symbol::new(env, "mig"), soroban_sdk::Symbol::new(env, "aborted")),
        (crate::config::SCHEMA_VERSION, env.ledger().sequence(), caller.clone()),
    );

    Ok(())
}

// ─── Cross-contract migration (export / import) ───────────────────────────────

/// Export complete contract state for cross-contract migration.
pub fn export_state(env: &Env) -> Result<MigrationSnapshot, ContractError> {
    let instance_data = InstanceData {
        admin: crate::storage::get_admin(env)?,
        usdc_token: crate::storage::get_usdc_token(env)?,
        platform_fee_bps: crate::storage::get_platform_fee_bps(env)?,
        remittance_counter: crate::storage::get_remittance_counter(env)?,
        accumulated_fees: crate::storage::get_accumulated_fees(env)?,
        paused: crate::storage::is_paused(env),
        admin_count: crate::storage::get_admin_count(env),
    };

    // Collect all remittances.
    let mut remittances = Vec::new(env);
    let counter = instance_data.remittance_counter;
    for id in 1..=counter {
        if let Ok(remittance) = crate::storage::get_remittance(env, id) {
            remittances.push_back(remittance);
        }
    }

    // Collect all registered agents via the AgentList index.
    let agent_addresses = crate::storage::get_admin_list(env);
    let mut agents: Vec<AgentRecord> = Vec::new(env);
    for i in 0..agent_addresses.len() {
        let addr = agent_addresses.get_unchecked(i);
        let registered = crate::storage::is_agent_registered(env, &addr);
        let kyc_hash = crate::storage::get_agent_kyc_hash(env, &addr);
        agents.push_back(AgentRecord {
            address: addr,
            registered,
            kyc_hash,
        });
    }

    // Collect admin roles.
    let admin_roles = Vec::new(env); // iterable only via AdminRole index (future work)

    // Collect settled remittance IDs.
    let mut settlement_hashes = Vec::new(env);
    for id in 1..=counter {
        if crate::storage::has_settlement_hash(env, id) {
            settlement_hashes.push_back(id);
        }
    }

    // Collect whitelisted tokens.
    let whitelisted_tokens = crate::storage::get_all_whitelisted_tokens(env);

    let persistent_data = PersistentData {
        remittances,
        agents,
        admin_roles,
        settlement_hashes,
        whitelisted_tokens,
    };

    let timestamp = env.ledger().timestamp();
    let ledger_sequence = env.ledger().sequence();

    let verification_hash = compute_snapshot_hash(
        env,
        &instance_data,
        &persistent_data,
        timestamp,
        ledger_sequence,
    );

    Ok(MigrationSnapshot {
        version: 1,
        timestamp,
        ledger_sequence,
        instance_data,
        persistent_data,
        verification_hash,
    })
}

/// Import contract state from a migration snapshot (full import, not batched).
pub fn import_state(env: &Env, snapshot: MigrationSnapshot) -> Result<(), ContractError> {
    if crate::storage::has_admin(env) {
        return Err(ContractError::AlreadyInitialized);
    }

    let computed_hash = compute_snapshot_hash(
        env,
        &snapshot.instance_data,
        &snapshot.persistent_data,
        snapshot.timestamp,
        snapshot.ledger_sequence,
    );

    if computed_hash != snapshot.verification_hash {
        return Err(ContractError::InvalidMigrationHash);
    }

    // Import instance data.
    crate::storage::set_admin(env, &snapshot.instance_data.admin);
    crate::storage::set_usdc_token(env, &snapshot.instance_data.usdc_token);
    crate::storage::set_platform_fee_bps(env, snapshot.instance_data.platform_fee_bps);
    crate::storage::set_remittance_counter(env, snapshot.instance_data.remittance_counter);
    crate::storage::set_accumulated_fees(env, snapshot.instance_data.accumulated_fees);
    crate::storage::set_paused(env, snapshot.instance_data.paused);
    crate::storage::set_admin_count(env, snapshot.instance_data.admin_count);

    // Import remittances.
    for i in 0..snapshot.persistent_data.remittances.len() {
        let remittance = snapshot.persistent_data.remittances.get_unchecked(i);
        crate::storage::set_remittance(env, remittance.id, &remittance);
    }

    // Import agents (registration flag + KYC hash + AgentList index).
    for i in 0..snapshot.persistent_data.agents.len() {
        let record = snapshot.persistent_data.agents.get_unchecked(i);
        crate::storage::set_agent_registered(env, &record.address, record.registered);
        if let Some(ref hash) = record.kyc_hash {
            crate::storage::set_agent_kyc_hash(env, &record.address, hash);
        }
    }

    // Import admin roles.
    for i in 0..snapshot.persistent_data.admin_roles.len() {
        let admin = snapshot.persistent_data.admin_roles.get_unchecked(i);
        crate::storage::set_admin_role(env, &admin, true);
    }

    // Import settlement hashes.
    for i in 0..snapshot.persistent_data.settlement_hashes.len() {
        let id = snapshot.persistent_data.settlement_hashes.get_unchecked(i);
        crate::storage::set_settlement_hash(env, id);
    }

    // Import whitelisted tokens.
    for i in 0..snapshot.persistent_data.whitelisted_tokens.len() {
        let token = snapshot.persistent_data.whitelisted_tokens.get_unchecked(i);
        crate::storage::set_token_whitelisted(env, &token, true);
    }

    Ok(())
}

// ─── Batch export / import ────────────────────────────────────────────────────

/// Export state in batches for large datasets.
pub fn export_batch(
    env: &Env,
    batch_number: u32,
    batch_size: u32,
) -> Result<MigrationBatch, ContractError> {
    if batch_size == 0 || batch_size > MAX_MIGRATION_BATCH_SIZE {
        return Err(ContractError::InvalidAmount);
    }

    let counter = crate::storage::get_remittance_counter(env)?;
    let total_batches = (counter as u32).div_ceil(batch_size);

    if batch_number >= total_batches {
        return Err(ContractError::InvalidAmount);
    }

    let start_id = (batch_number * batch_size) as u64 + 1;
    let end_id = ((batch_number + 1) * batch_size).min(counter as u32) as u64;

    let mut remittances = Vec::new(env);
    for id in start_id..=end_id {
        if let Ok(remittance) = crate::storage::get_remittance(env, id) {
            remittances.push_back(remittance);
        }
    }

    let batch_hash = compute_batch_hash(env, &remittances, batch_number);

    Ok(MigrationBatch {
        batch_number,
        total_batches,
        remittances,
        batch_hash,
    })
}

/// Import a single batch of remittances with checkpoint/resume semantics.
///
/// Sets `MigrationInProgress` flag at the start of the first batch and clears it
/// after the final batch completes successfully. If any batch fails, the flag
/// remains set, blocking normal operations until the migration is resumed or rolled back.
pub fn import_batch(env: &Env, batch: MigrationBatch) -> Result<(), ContractError> {
    let computed_hash = compute_batch_hash(env, &batch.remittances, batch.batch_number);

    if computed_hash != batch.batch_hash {
        return Err(ContractError::InvalidMigrationHash);
    }

    // Enforce strict monotonic ordering: reject any batch whose index != expected_next_batch.
    let expected = get_expected_next_batch(env);
    if batch.batch_number != expected {
        return Err(ContractError::InvalidMigrationBatch);
    }

    // Set migration flag on first batch
    if batch.batch_number == 0 {
        set_migration_in_progress(env, true);
    }

    // Import remittances for this batch
    for i in 0..batch.remittances.len() {
        let remittance = batch.remittances.get_unchecked(i);
        crate::storage::set_remittance(env, remittance.id, &remittance);
    }

    // Advance the counter for the next expected batch.
    set_expected_next_batch(env, expected + 1);

    // Clear the flag after the final batch completes successfully
    if batch.batch_number == batch.total_batches.saturating_sub(1) {
        clear_expected_next_batch(env);
        set_migration_in_progress(env, false);
    }

    Ok(())
}

// ─── Hashing helpers ─────────────────────────────────────────────────────────

fn compute_snapshot_hash(
    env: &Env,
    instance_data: &InstanceData,
    persistent_data: &PersistentData,
    timestamp: u64,
    ledger_sequence: u32,
) -> BytesN<32> {
    let mut data = Bytes::new(env);

    data.append(&instance_data.admin.clone().to_xdr(env));
    data.append(&instance_data.usdc_token.clone().to_xdr(env));
    data.append(&Bytes::from_array(env, &instance_data.platform_fee_bps.to_be_bytes()));
    data.append(&Bytes::from_array(env, &instance_data.remittance_counter.to_be_bytes()));
    data.append(&Bytes::from_array(env, &instance_data.accumulated_fees.to_be_bytes()));
    data.append(&Bytes::from_array(env, &[if instance_data.paused { 1u8 } else { 0u8 }]));
    data.append(&Bytes::from_array(env, &instance_data.admin_count.to_be_bytes()));

    for i in 0..persistent_data.remittances.len() {
        let r = persistent_data.remittances.get_unchecked(i);
        data.append(&Bytes::from_array(env, &r.id.to_be_bytes()));
        data.append(&r.sender.clone().to_xdr(env));
        data.append(&r.agent.clone().to_xdr(env));
        data.append(&Bytes::from_array(env, &r.amount.to_be_bytes()));
        data.append(&Bytes::from_array(env, &r.fee.to_be_bytes()));
        data.append(&Bytes::from_array(env, &[status_to_byte(&r.status)]));
        if let Some(expiry) = r.expiry {
            data.append(&Bytes::from_array(env, &expiry.to_be_bytes()));
        }
    }

    for i in 0..persistent_data.agents.len() {
        let record = persistent_data.agents.get_unchecked(i);
        data.append(&record.address.clone().to_xdr(env));
        data.append(&Bytes::from_array(env, &[if record.registered { 1u8 } else { 0u8 }]));
    }

    for i in 0..persistent_data.admin_roles.len() {
        let admin = persistent_data.admin_roles.get_unchecked(i);
        data.append(&admin.clone().to_xdr(env));
    }

    for i in 0..persistent_data.settlement_hashes.len() {
        let id = persistent_data.settlement_hashes.get_unchecked(i);
        data.append(&Bytes::from_array(env, &id.to_be_bytes()));
    }

    for i in 0..persistent_data.whitelisted_tokens.len() {
        let token = persistent_data.whitelisted_tokens.get_unchecked(i);
        data.append(&token.clone().to_xdr(env));
    }

    data.append(&Bytes::from_array(env, &timestamp.to_be_bytes()));
    data.append(&Bytes::from_array(env, &ledger_sequence.to_be_bytes()));

    env.crypto().sha256(&data).into()
}

fn compute_batch_hash(env: &Env, remittances: &Vec<Remittance>, batch_number: u32) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.append(&Bytes::from_array(env, &batch_number.to_be_bytes()));

    for i in 0..remittances.len() {
        let r = remittances.get_unchecked(i);
        data.append(&Bytes::from_array(env, &r.id.to_be_bytes()));
        data.append(&r.sender.clone().to_xdr(env));
        data.append(&r.agent.clone().to_xdr(env));
        data.append(&Bytes::from_array(env, &r.amount.to_be_bytes()));
        data.append(&Bytes::from_array(env, &r.fee.to_be_bytes()));
        data.append(&Bytes::from_array(env, &[status_to_byte(&r.status)]));
        if let Some(expiry) = r.expiry {
            data.append(&Bytes::from_array(env, &expiry.to_be_bytes()));
        }
    }

    env.crypto().sha256(&data).into()
}

/// Verify migration snapshot integrity without importing.
pub fn verify_snapshot(env: &Env, snapshot: &MigrationSnapshot) -> MigrationVerification {
    let computed_hash = compute_snapshot_hash(
        env,
        &snapshot.instance_data,
        &snapshot.persistent_data,
        snapshot.timestamp,
        snapshot.ledger_sequence,
    );

    MigrationVerification {
        valid: computed_hash == snapshot.verification_hash,
        expected_hash: snapshot.verification_hash.clone(),
        actual_hash: computed_hash,
        timestamp: env.ledger().timestamp(),
    }
}
