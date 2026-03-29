//! Storage management for the SwiftRemit contract.
//!
//! This module provides functions for reading and writing contract state,
//! including configuration, remittance records, agent registration, and fee tracking.
//! Uses both instance storage (contract-level config) and persistent storage
//! (per-entity data).

use soroban_sdk::{contracttype, Address, Env, String, Vec};

use crate::{ContractError, Remittance, TransferRecord, DailyLimit, AgentStats};

/// Storage keys for the SwiftRemit contract.
///
/// Storage Layout:
/// - Instance storage: Contract-level configuration and state (Admin, UsdcToken, PlatformFeeBps,
///   RemittanceCounter, AccumulatedFees)
/// - Persistent storage: Per-entity data that needs long-term retention (Remittance records,
///   AgentRegistered status)
#[contracttype]
#[derive(Clone)]
enum DataKey {
    // === Contract Configuration ===
    // Core contract settings stored in instance storage
    /// Contract administrator address with privileged access (instance storage, deprecated - use AdminRole)
    Admin,

    /// Admin role status indexed by address (persistent storage)
    AdminRole(Address),

    /// Counter for tracking number of admins (instance storage)
    AdminCount,

    /// Role assignment indexed by (address, role) (persistent storage)
    RoleAssignment(Address, crate::Role),

    /// USDC token contract address used for all remittance transactions (instance storage)
    UsdcToken,

    /// Platform fee in basis points, 1 bps = 0.01% (instance storage)
    PlatformFeeBps,

    /// Protocol fee in basis points, 1 bps = 0.01% (instance storage)
    ProtocolFeeBps,

    /// Treasury address that receives protocol fees (instance storage)
    Treasury,

    // === Remittance Management ===
    // Keys for tracking and storing remittance transactions
    /// Global counter for generating unique remittance IDs (instance storage)
    RemittanceCounter,

    /// Individual remittance record indexed by ID (persistent storage)
    Remittance(u64),

    // === Agent Management ===
    // Keys for tracking registered agents
    /// Agent registration status indexed by agent address (persistent storage)
    AgentRegistered(Address),

    // === Fee Tracking ===
    // Keys for managing platform fees
    /// Total accumulated platform fees awaiting withdrawal (instance storage)
    AccumulatedFees,

    /// Integrator fee in basis points (instance storage)
    IntegratorFeeBps,

    /// Total accumulated integrator fees awaiting withdrawal (instance storage)
    AccumulatedIntegratorFees,

    /// Contract pause status for emergency halts (instance storage)
    Paused,

    // === Settlement Deduplication ===
    // Keys for preventing duplicate settlement execution
    /// Settlement hash for duplicate detection (legacy persistent storage)
    SettlementHash(u64),

    // === User Management ===
    // Keys for user eligibility and KYC tracking
    /// User blacklist status (persistent storage)
    UserBlacklisted(Address),

    /// User KYC approval status (persistent storage)
    KycApproved(Address),

    /// User KYC expiry timestamp (persistent storage)
    KycExpiry(Address),

    // === Transaction Controller ===
    // Keys for transaction tracking and anchor operations
    /// Transaction record indexed by remittance ID (persistent storage)
    TransactionRecord(u64),

    /// Anchor transaction mapping (persistent storage)
    AnchorTransaction(u64),

    /// Combined settlement metadata (legacy persistent storage)
    /// Contains flags that were previously stored separately to reduce reads.
    SettlementData(u64),

    /// Packed settlement flags (persistent storage)
    /// Replaces scattered settlement keys with a compact bitfield.
    SettlementPacked(u64),

    // === Rate Limiting ===
    // Keys for preventing abuse through rate limiting
    /// Cooldown period in seconds between settlements per sender (instance storage)
    RateLimitCooldown,

    /// Last settlement timestamp for a sender address (persistent storage)
    LastSettlementTime(Address),

    // === Daily Limits ===
    // Keys for tracking daily transfer limits
    /// Daily limit configuration indexed by currency and country (persistent storage)
    DailyLimit(String, String),

    /// User transfer records indexed by user address (persistent storage)
    UserTransfers(Address),

    // === Token Whitelist ===
    // Keys for managing whitelisted tokens
    /// Token whitelist status indexed by token address (persistent storage)
    TokenWhitelisted(Address),

    /// Settlement completion event emission tracking (legacy persistent storage)
    /// Tracks whether the completion event has been emitted for a settlement
    SettlementEventEmitted(u64),


    /// Total number of successfully finalized settlements (instance storage)
    /// Incremented atomically each time a settlement is successfully completed
    SettlementCounter,

    // === Escrow Management ===
    /// Escrow counter for generating unique transfer IDs (instance storage)
    EscrowCounter,

    /// Escrow record indexed by transfer ID (persistent storage)
    Escrow(u64),

    // === Transfer State Registry ===
    /// Transfer state indexed by transfer ID (persistent storage)
    TransferState(u64),

    /// Fee strategy configuration (instance storage)
    FeeStrategy,

    /// Fee corridor configuration indexed by (from_country, to_country) (persistent storage)
    FeeCorridor(String, String),

    // === Idempotency Protection ===
    // Keys for preventing duplicate remittance creation
    /// Idempotency record indexed by idempotency key (persistent storage)
    /// Stores remittance_id and request hash for duplicate detection
    IdempotencyRecord(String),

    /// Reverse mapping: remittance_id -> idempotency key (persistent storage)
    /// Used to clean up the idempotency record when a remittance reaches a terminal state
    RemittanceIdempotencyKey(u64),

    /// TTL for idempotency records in seconds (instance storage)
    IdempotencyTTL,

    // === Migration ===
    /// Flag indicating a migration is currently in progress (instance storage).
    /// When set, normal write operations (create_remittance, confirm_payout, etc.) are blocked.
    MigrationInProgress,

    /// Commitment hash used to validate off-chain payout proofs per remittance.
    PayoutCommitment(u64),

    // === Analytics ===
    /// Total number of remittances ever created (instance storage).
    TotalRemittanceCount,

    /// Cumulative volume of completed remittances in USDC stroops (instance storage).
    TotalCompletedVolume,
}

/// Checks if the contract has an admin configured.
/// * `true` - Admin is configured
/// * `false` - Admin is not configured (contract not initialized)
pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

/// Sets the contract administrator address.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `admin` - Address to set as admin
pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

/// Retrieves the contract administrator address.
///
/// # Arguments
///
/// * `env` - The contract execution environment
///
/// # Returns
///
/// * `Ok(Address)` - The admin address
/// * `Err(ContractError::NotInitialized)` - Contract not initialized
pub fn get_admin(env: &Env) -> Result<Address, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(ContractError::NotInitialized)
}

/// Sets the USDC token contract address.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `token` - Address of the USDC token contract
pub fn set_usdc_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::UsdcToken, token);
}

/// Retrieves the USDC token contract address.
///
/// # Arguments
///
/// * `env` - The contract execution environment
///
/// # Returns
///
/// * `Ok(Address)` - The USDC token contract address
/// * `Err(ContractError::NotInitialized)` - Contract not initialized
pub fn get_usdc_token(env: &Env) -> Result<Address, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::UsdcToken)
        .ok_or(ContractError::NotInitialized)
}

/// Sets the platform fee rate.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `fee_bps` - Fee in basis points (1 bps = 0.01%)
pub fn set_platform_fee_bps(env: &Env, fee_bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::PlatformFeeBps, &fee_bps);
}

/// Retrieves the platform fee rate.
///
/// # Arguments
///
/// * `env` - The contract execution environment
///
/// # Returns
///
/// * `Ok(u32)` - Fee in basis points
/// * `Err(ContractError::NotInitialized)` - Contract not initialized
pub fn get_platform_fee_bps(env: &Env) -> Result<u32, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::PlatformFeeBps)
        .ok_or(ContractError::NotInitialized)
}

/// Sets the remittance counter for ID generation.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `counter` - Current counter value
pub fn set_remittance_counter(env: &Env, counter: u64) {
    env.storage()
        .instance()
        .set(&DataKey::RemittanceCounter, &counter);
}

/// Retrieves the current remittance counter.
///
/// # Arguments
///
/// * `env` - The contract execution environment
///
/// # Returns
///
/// * `Ok(u64)` - Current counter value
/// * `Err(ContractError::NotInitialized)` - Contract not initialized
pub fn get_remittance_counter(env: &Env) -> Result<u64, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::RemittanceCounter)
        .ok_or(ContractError::NotInitialized)
}

/// Stores a remittance record.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `id` - Remittance ID
/// * `remittance` - Remittance record to store
pub fn set_remittance(env: &Env, id: u64, remittance: &Remittance) {
    env.storage()
        .persistent()
        .set(&DataKey::Remittance(id), remittance);
}

/// Retrieves a remittance record by ID.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `id` - Remittance ID to retrieve
///
/// # Returns
///
/// * `Ok(Remittance)` - The remittance record
/// * `Err(ContractError::RemittanceNotFound)` - Remittance does not exist
pub fn get_remittance(env: &Env, id: u64) -> Result<Remittance, ContractError> {
    env.storage()
        .persistent()
        .get(&DataKey::Remittance(id))
        .ok_or(ContractError::RemittanceNotFound)
}

/// Sets an agent's registration status.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `agent` - Agent address
/// * `registered` - Registration status (true = registered, false = removed)
pub fn set_agent_registered(env: &Env, agent: &Address, registered: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::AgentRegistered(agent.clone()), &registered);
}

/// Checks if an address is registered as an agent.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `agent` - Agent address to check
///
/// # Returns
///
/// * `true` - Address is registered
/// * `false` - Address is not registered
pub fn is_agent_registered(env: &Env, agent: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::AgentRegistered(agent.clone()))
        .unwrap_or(false)
}

/// Sets the accumulated platform fees.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `fees` - Total accumulated fees
pub fn set_accumulated_fees(env: &Env, fees: i128) {
    env.storage()
        .instance()
        .set(&DataKey::AccumulatedFees, &fees);
}

/// Retrieves the accumulated platform fees.
///
/// # Arguments
///
/// * `env` - The contract execution environment
///
/// # Returns
///
/// * `Ok(i128)` - Total accumulated fees
/// * `Err(ContractError::NotInitialized)` - Contract not initialized
pub fn get_accumulated_fees(env: &Env) -> Result<i128, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::AccumulatedFees)
        .ok_or(ContractError::NotInitialized)
}

pub fn set_accumulated_integrator_fees(env: &Env, fees: i128) {
    env.storage()
        .instance()
        .set(&DataKey::AccumulatedIntegratorFees, &fees);
}

pub fn get_accumulated_integrator_fees(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::AccumulatedIntegratorFees)
        .unwrap_or(0)
}

/// Checks if a settlement hash exists for duplicate detection.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance_id` - Remittance ID to check
///
/// # Returns
///
/// * `true` - Settlement has been executed
/// * `false` - Settlement has not been executed
const SETTLEMENT_EXECUTED_FLAG: u32 = 1;
const SETTLEMENT_EVENT_EMITTED_FLAG: u32 = 1 << 1;

#[contracttype]
#[derive(Clone)]
pub struct LegacySettlementData {
    pub executed: bool,
    pub event_emitted: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct SettlementPacked {
    pub flags: u32,
}

impl SettlementPacked {
    fn new(executed: bool, event_emitted: bool) -> Self {
        let mut flags = 0;
        if executed {
            flags |= SETTLEMENT_EXECUTED_FLAG;
        }
        if event_emitted {
            flags |= SETTLEMENT_EVENT_EMITTED_FLAG;
        }
        Self { flags }
    }

    fn executed(&self) -> bool {
        (self.flags & SETTLEMENT_EXECUTED_FLAG) != 0
    }

    fn event_emitted(&self) -> bool {
        (self.flags & SETTLEMENT_EVENT_EMITTED_FLAG) != 0
    }

    fn set_executed(&mut self, value: bool) {
        if value {
            self.flags |= SETTLEMENT_EXECUTED_FLAG;
        } else {
            self.flags &= !SETTLEMENT_EXECUTED_FLAG;
        }
    }

    fn set_event_emitted(&mut self, value: bool) {
        if value {
            self.flags |= SETTLEMENT_EVENT_EMITTED_FLAG;
        } else {
            self.flags &= !SETTLEMENT_EVENT_EMITTED_FLAG;
        }
    }
}

/// Internal helper: load or migrate settlement metadata into a packed key.
fn load_or_migrate_settlement_packed(env: &Env, remittance_id: u64) -> SettlementPacked {
    let packed_key = DataKey::SettlementPacked(remittance_id);

    if let Some(data) = env.storage().persistent().get(&packed_key) {
        return data;
    }

    if let Some(legacy) = env
        .storage()
        .persistent()
        .get::<DataKey, LegacySettlementData>(&DataKey::SettlementData(remittance_id))
    {
        let packed = SettlementPacked::new(legacy.executed, legacy.event_emitted);
        env.storage().persistent().set(&packed_key, &packed);
        env.storage().persistent().remove(&DataKey::SettlementData(remittance_id));
        return packed;
    }

    let executed = env
        .storage()
        .persistent()
        .get(&DataKey::SettlementHash(remittance_id))
        .unwrap_or(false);
    let event_emitted = env
        .storage()
        .persistent()
        .get(&DataKey::SettlementEventEmitted(remittance_id))
        .unwrap_or(false);

    let packed = SettlementPacked::new(executed, event_emitted);

    env.storage().persistent().set(&packed_key, &packed);
    env.storage().persistent().remove(&DataKey::SettlementHash(remittance_id));
    env.storage().persistent().remove(&DataKey::SettlementEventEmitted(remittance_id));

    packed
}

/// Checks if a settlement has already been executed (duplicate detection).
pub fn has_settlement_hash(env: &Env, remittance_id: u64) -> bool {
    let data = load_or_migrate_settlement_packed(env, remittance_id);
    data.executed()
}

/// Marks a settlement as executed for duplicate prevention.
pub fn set_settlement_hash(env: &Env, remittance_id: u64) {
    let key = DataKey::SettlementPacked(remittance_id);
    let mut data = load_or_migrate_settlement_packed(env, remittance_id);
    if data.executed() {
        return; // Skip write if already set
    }
    data.set_executed(true);
    env.storage().persistent().set(&key, &data);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

// === User Management Functions ===

pub fn is_user_blacklisted(env: &Env, user: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::UserBlacklisted(user.clone()))
        .unwrap_or(false)
}

pub fn set_user_blacklisted(env: &Env, user: &Address, blacklisted: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::UserBlacklisted(user.clone()), &blacklisted);
}

pub fn is_kyc_approved(env: &Env, user: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::KycApproved(user.clone()))
        .unwrap_or(false)
}

pub fn set_kyc_approved(env: &Env, user: &Address, approved: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::KycApproved(user.clone()), &approved);
}

pub fn is_kyc_expired(env: &Env, user: &Address) -> bool {
    if let Some(expiry) = env.storage()
        .persistent()
        .get::<DataKey, u64>(&DataKey::KycExpiry(user.clone()))
    {
        let current_time = env.ledger().timestamp();
        current_time > expiry
    } else {
        false
    }
}

pub fn set_kyc_expiry(env: &Env, user: &Address, expiry: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::KycExpiry(user.clone()), &expiry);
}

// === Transaction Controller Functions ===

pub fn set_transaction_record(
    env: &Env,
    remittance_id: u64,
    record: &crate::transaction_controller::TransactionRecord,
) -> Result<(), ContractError> {
    env.storage()
        .persistent()
        .set(&DataKey::TransactionRecord(remittance_id), record);
    Ok(())
}

pub fn get_transaction_record(
    env: &Env,
    remittance_id: u64,
) -> Result<crate::transaction_controller::TransactionRecord, ContractError> {
    env.storage()
        .persistent()
        .get(&DataKey::TransactionRecord(remittance_id))
        .ok_or(ContractError::TransactionNotFound)
}

pub fn set_anchor_transaction(
    env: &Env,
    anchor_tx_id: u64,
    remittance_id: u64,
) -> Result<(), ContractError> {
    env.storage()
        .persistent()
        .set(&DataKey::AnchorTransaction(anchor_tx_id), &remittance_id);
    Ok(())
}

pub fn get_anchor_transaction(
    env: &Env,
    anchor_tx_id: u64,
) -> Result<u64, ContractError> {
    env.storage()
        .persistent()
        .get(&DataKey::AnchorTransaction(anchor_tx_id))
        .ok_or(ContractError::TransactionNotFound)
}

pub fn remove_anchor_transaction(env: &Env, anchor_tx_id: u64) -> Result<(), ContractError> {
    env.storage()
        .persistent()
        .remove(&DataKey::AnchorTransaction(anchor_tx_id));
    Ok(())
}

pub fn set_rate_limit_cooldown(env: &Env, cooldown_seconds: u64) {
    env.storage()
        .instance()
        .set(&DataKey::RateLimitCooldown, &cooldown_seconds);
}

pub fn get_rate_limit_cooldown(env: &Env) -> Result<u64, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::RateLimitCooldown)
        .ok_or(ContractError::NotInitialized)
}

pub fn set_last_settlement_time(env: &Env, sender: &Address, timestamp: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::LastSettlementTime(sender.clone()), &timestamp);
}

pub fn get_last_settlement_time(env: &Env, sender: &Address) -> Option<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::LastSettlementTime(sender.clone()))
}

pub fn check_settlement_rate_limit(env: &Env, sender: &Address) -> Result<(), ContractError> {
    let cooldown = get_rate_limit_cooldown(env)?;

    // If cooldown is 0, rate limiting is disabled
    if cooldown == 0 {
        return Ok(());
    }

    if let Some(last_time) = get_last_settlement_time(env, sender) {
        let current_time = env.ledger().timestamp();
        let elapsed = current_time.saturating_sub(last_time);

        if elapsed < cooldown {
            return Err(ContractError::RateLimitExceeded);
        }
    }

    Ok(())
}

pub fn set_daily_limit(env: &Env, currency: &String, country: &String, limit: i128) {
    let daily_limit = DailyLimit {
        currency: currency.clone(),
        country: country.clone(),
        limit,
    };
    env.storage()
        .persistent()
        .set(&DataKey::DailyLimit(currency.clone(), country.clone()), &daily_limit);
}

pub fn get_daily_limit(env: &Env, currency: &String, country: &String) -> Option<DailyLimit> {
    env.storage()
        .persistent()
        .get(&DataKey::DailyLimit(currency.clone(), country.clone()))
}

pub fn get_user_transfers(env: &Env, user: &Address) -> Vec<TransferRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::UserTransfers(user.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn set_user_transfers(env: &Env, user: &Address, transfers: &Vec<TransferRecord>) {
    env.storage()
        .persistent()
        .set(&DataKey::UserTransfers(user.clone()), transfers);
}

pub fn is_migration_in_progress(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::MigrationInProgress)
        .unwrap_or(false)
}

pub fn set_migration_in_progress(env: &Env, in_progress: bool) {
    env.storage()
        .instance()
        .set(&DataKey::MigrationInProgress, &in_progress);
}

// === Admin Role Management ===

pub fn is_admin(env: &Env, address: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::AdminRole(address.clone()))
        .unwrap_or(false)
}

pub fn set_admin_role(env: &Env, address: &Address, is_admin: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::AdminRole(address.clone()), &is_admin);
}

pub fn get_admin_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::AdminCount)
        .unwrap_or(0)
}

pub fn set_admin_count(env: &Env, count: u32) {
    env.storage().instance().set(&DataKey::AdminCount, &count);
}

pub fn require_admin(env: &Env, address: &Address) -> Result<(), ContractError> {
    address.require_auth();

    if !is_admin(env, address) {
        return Err(ContractError::Unauthorized);
    }

    Ok(())
}

// === Token Whitelist Management ===

pub fn is_token_whitelisted(env: &Env, token: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::TokenWhitelisted(token.clone()))
        .unwrap_or(false)
}

pub fn set_token_whitelisted(env: &Env, token: &Address, whitelisted: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::TokenWhitelisted(token.clone()), &whitelisted);
}

// === Settlement Event Emission Tracking ===

/// Checks if the settlement completion event has been emitted for a remittance.
///
/// This function is used to ensure exactly-once event emission per finalized settlement,
/// preventing duplicate events in cases of re-entry, retries, or repeated calls.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance_id` - The unique ID of the remittance/settlement
///
/// # Returns
///
/// * `true` - Event has been emitted for this settlement
/// * `false` - Event has not been emitted yet
pub fn has_settlement_event_emitted(env: &Env, remittance_id: u64) -> bool {
    let data = load_or_migrate_settlement_packed(env, remittance_id);
    data.event_emitted()
}

/// Marks that the settlement completion event has been emitted for a remittance.
///
/// This function should be called immediately after emitting the settlement completion
/// event to prevent duplicate emissions. It provides a persistent record that the
/// event was successfully emitted.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance_id` - The unique ID of the remittance/settlement
///
/// # Guarantees
///
/// - Idempotent: Can be called multiple times safely
/// - Persistent: Survives contract upgrades and restarts
/// - Deterministic: Always produces the same result for the same input
pub fn set_settlement_event_emitted(env: &Env, remittance_id: u64) {
    let key = DataKey::SettlementPacked(remittance_id);
    let mut data = load_or_migrate_settlement_packed(env, remittance_id);
    if data.event_emitted() {
        return; // Skip write if already set
    }
    data.set_event_emitted(true);
    env.storage().persistent().set(&key, &data);
}

#[cfg(feature = "benchmarks")]
pub fn bench_settlement_scattered_write(
    env: &Env,
    remittance_id: u64,
    executed: bool,
    event_emitted: bool,
) {
    env.storage()
        .persistent()
        .set(&DataKey::SettlementHash(remittance_id), &executed);
    env.storage()
        .persistent()
        .set(&DataKey::SettlementEventEmitted(remittance_id), &event_emitted);
}

#[cfg(feature = "benchmarks")]
pub fn bench_settlement_scattered_read(env: &Env, remittance_id: u64) -> (bool, bool) {
    let executed = env
        .storage()
        .persistent()
        .get(&DataKey::SettlementHash(remittance_id))
        .unwrap_or(false);
    let event_emitted = env
        .storage()
        .persistent()
        .get(&DataKey::SettlementEventEmitted(remittance_id))
        .unwrap_or(false);
    (executed, event_emitted)
}

#[cfg(feature = "benchmarks")]
pub fn bench_settlement_packed_write(
    env: &Env,
    remittance_id: u64,
    executed: bool,
    event_emitted: bool,
) {
    let key = DataKey::SettlementPacked(remittance_id);
    let packed = SettlementPacked::new(executed, event_emitted);
    env.storage().persistent().set(&key, &packed);
}

#[cfg(feature = "benchmarks")]
pub fn bench_settlement_packed_read(env: &Env, remittance_id: u64) -> SettlementPacked {
    env.storage()
        .persistent()
        .get(&DataKey::SettlementPacked(remittance_id))
        .unwrap_or(SettlementPacked::new(false, false))
}


// === Settlement Counter ===

/// Retrieves the total number of successfully finalized settlements.
///
/// This function performs an O(1) read directly from instance storage without
/// iteration or recomputation. The counter is incremented atomically each time
/// a settlement is successfully finalized.
///
/// # Arguments
///
/// * `env` - The contract execution environment
///
/// # Returns
///
/// * `u64` - Total number of settlements processed (defaults to 0 if not initialized)
///
/// # Performance
///
/// - O(1) constant-time operation
/// - Single storage read
/// - No iteration or computation
///
/// # Guarantees
///
/// - Read-only: Cannot modify storage
/// - Deterministic: Always returns same value for same state
/// - Consistent: Reflects all successfully finalized settlements
pub fn get_settlement_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::SettlementCounter)
        .unwrap_or(0)
}

/// Increments the settlement counter atomically.
///
/// This function should only be called after a settlement is successfully finalized
/// and all state transitions are committed. It increments the counter by 1 and
/// stores the new value in instance storage.
///
/// # Arguments
///
/// * `env` - The contract execution environment
///
/// # Returns
///
/// * `Ok(())` - Counter incremented successfully
/// * `Err(ContractError::SettlementCounterOverflow)` - Counter would overflow u64::MAX
///
/// # Guarantees
///
/// - Atomic: Increment and store happen together
/// - Internal-only: Not exposed as public contract function
/// - Deterministic: Always increments by exactly 1
/// - Consistent: Only called after successful finalization
pub fn increment_settlement_counter(env: &Env) -> Result<(), ContractError> {
    let current = get_settlement_counter(env);
    let new_count = current
        .checked_add(1)
        .ok_or(ContractError::SettlementCounterOverflow)?;
    env.storage()
        .instance()
        .set(&DataKey::SettlementCounter, &new_count);
    Ok(())
}

// === Escrow Management ===

pub fn get_escrow_counter(env: &Env) -> Result<u64, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::EscrowCounter)
        .ok_or(ContractError::NotInitialized)
}

pub fn set_escrow_counter(env: &Env, counter: u64) {
    env.storage().instance().set(&DataKey::EscrowCounter, &counter);
}

pub fn get_escrow(env: &Env, transfer_id: u64) -> Result<crate::Escrow, ContractError> {
    env.storage()
        .persistent()
        .get(&DataKey::Escrow(transfer_id))
        .ok_or(ContractError::EscrowNotFound)
}

pub fn set_escrow(env: &Env, transfer_id: u64, escrow: &crate::Escrow) {
    env.storage()
        .persistent()
        .set(&DataKey::Escrow(transfer_id), escrow);
}


// === Role-Based Authorization ===

/// Assigns a role to an address
pub fn assign_role(env: &Env, address: &Address, role: &crate::Role) {
    env.storage()
        .persistent()
        .set(&DataKey::RoleAssignment(address.clone(), role.clone()), &true);
}

/// Removes a role from an address
pub fn remove_role(env: &Env, address: &Address, role: &crate::Role) {
    env.storage()
        .persistent()
        .remove(&DataKey::RoleAssignment(address.clone(), role.clone()));
}

/// Checks if an address has a specific role
pub fn has_role(env: &Env, address: &Address, role: &crate::Role) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::RoleAssignment(address.clone(), role.clone()))
        .unwrap_or(false)
}

/// Requires that the caller has Admin role
pub fn require_role_admin(env: &Env, address: &Address) -> Result<(), ContractError> {
    if !has_role(env, address, &crate::Role::Admin) {
        return Err(ContractError::Unauthorized);
    }
    Ok(())
}

/// Requires that the caller has Settler role
pub fn require_role_settler(env: &Env, address: &Address) -> Result<(), ContractError> {
    if !has_role(env, address, &crate::Role::Settler) {
        return Err(ContractError::Unauthorized);
    }
    Ok(())
}


// === Transfer State Registry ===

/// Gets the current state of a transfer
pub fn get_transfer_state(env: &Env, transfer_id: u64) -> Option<crate::TransferState> {
    env.storage()
        .persistent()
        .get(&DataKey::TransferState(transfer_id))
}

/// Sets the transfer state with validation
pub fn set_transfer_state(
    env: &Env,
    transfer_id: u64,
    new_state: crate::TransferState,
) -> Result<(), ContractError> {
    // Get current state if exists
    if let Some(current_state) = get_transfer_state(env, transfer_id) {
        // Validate transition
        if !current_state.can_transition_to(&new_state) {
            return Err(ContractError::InvalidStateTransition);
        }
        // Skip write if same state (storage-efficient)
        if current_state == new_state {
            return Ok(());
        }
    }

    // Write new state
    env.storage()
        .persistent()
        .set(&DataKey::TransferState(transfer_id), &new_state);

    Ok(())
}


// === Fee Strategy Management ===

/// Gets the current fee strategy
pub fn get_fee_strategy(env: &Env) -> crate::FeeStrategy {
    env.storage()
        .instance()
        .get(&DataKey::FeeStrategy)
        .unwrap_or(crate::FeeStrategy::Percentage(250)) // Default: 2.5%
}

/// Sets the fee strategy (admin only)
pub fn set_fee_strategy(env: &Env, strategy: &crate::FeeStrategy) {
    env.storage()
        .instance()
        .set(&DataKey::FeeStrategy, strategy);
}


// === Protocol Fee Management ===

/// Maximum protocol fee (200 bps = 2%)
pub const MAX_PROTOCOL_FEE_BPS: u32 = 200;

/// Gets the protocol fee in basis points
pub fn get_protocol_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ProtocolFeeBps)
        .unwrap_or(0)
}

/// Sets the protocol fee in basis points (max 200 bps)
pub fn set_protocol_fee_bps(env: &Env, fee_bps: u32) -> Result<(), ContractError> {
    if fee_bps > MAX_PROTOCOL_FEE_BPS {
        return Err(ContractError::InvalidFeeBps);
    }
    env.storage()
        .instance()
        .set(&DataKey::ProtocolFeeBps, &fee_bps);
    Ok(())
}

/// Gets the treasury address
pub fn get_treasury(env: &Env) -> Result<Address, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::Treasury)
        .ok_or(ContractError::NotInitialized)
}

/// Sets the treasury address
pub fn set_treasury(env: &Env, treasury: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::Treasury, treasury);
}

// === Fee Corridor Management ===

/// Sets a fee corridor configuration for a country pair
pub fn set_fee_corridor(env: &Env, corridor: &crate::fee_service::FeeCorridor) {
    let key = DataKey::FeeCorridor(
        corridor.from_country.clone(),
        corridor.to_country.clone(),
    );
    env.storage()
        .persistent()
        .set(&key, corridor);
}

/// Gets a fee corridor configuration for a country pair
pub fn get_fee_corridor(
    env: &Env,
    from_country: &String,
    to_country: &String,
) -> Option<crate::fee_service::FeeCorridor> {
    let key = DataKey::FeeCorridor(from_country.clone(), to_country.clone());
    env.storage()
        .persistent()
        .get(&key)
}

/// Removes a fee corridor configuration
pub fn remove_fee_corridor(env: &Env, from_country: &String, to_country: &String) {
    let key = DataKey::FeeCorridor(from_country.clone(), to_country.clone());
    env.storage()
        .persistent()
        .remove(&key);
}

// === Idempotency Protection ===

/// Gets an idempotency record if it exists and hasn't expired
pub fn get_idempotency_record(
    env: &Env,
    key: &String,
) -> Option<crate::IdempotencyRecord> {
    let storage_key = DataKey::IdempotencyRecord(key.clone());
    let record: Option<crate::IdempotencyRecord> = env.storage()
        .persistent()
        .get(&storage_key);
    
    if let Some(rec) = record {
        let current_time = env.ledger().timestamp();
        if current_time < rec.expires_at {
            return Some(rec);
        }
    }
    None
}

/// Stores an idempotency record
pub fn set_idempotency_record(
    env: &Env,
    key: &String,
    record: &crate::IdempotencyRecord,
) {
    let storage_key = DataKey::IdempotencyRecord(key.clone());
    env.storage()
        .persistent()
        .set(&storage_key, record);
}

/// Gets the configured TTL for idempotency records (default: 86400 seconds = 24 hours)
pub fn get_idempotency_ttl(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::IdempotencyTTL)
        .unwrap_or(86400)
}

/// Sets the idempotency TTL (admin only)
pub fn set_idempotency_ttl(env: &Env, ttl_seconds: u64) {
    env.storage()
        .instance()
        .set(&DataKey::IdempotencyTTL, &ttl_seconds);
}

/// Removes an idempotency record (called on terminal state transition)
pub fn remove_idempotency_record(env: &Env, key: &String) {
    env.storage()
        .persistent()
        .remove(&DataKey::IdempotencyRecord(key.clone()));
}

/// Stores the reverse mapping: remittance_id -> idempotency key
pub fn set_remittance_idempotency_key(env: &Env, remittance_id: u64, key: &String) {
    env.storage()
        .persistent()
        .set(&DataKey::RemittanceIdempotencyKey(remittance_id), key);
}

/// Retrieves and removes the reverse mapping, returning the key if present
pub fn take_remittance_idempotency_key(env: &Env, remittance_id: u64) -> Option<String> {
    let storage_key = DataKey::RemittanceIdempotencyKey(remittance_id);
    let key: Option<String> = env.storage().persistent().get(&storage_key);
    if key.is_some() {
        env.storage().persistent().remove(&storage_key);
    }
    key
}

/// Stores the payout commitment for a remittance.
pub fn set_payout_commitment(env: &Env, remittance_id: u64, commitment: &soroban_sdk::BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::PayoutCommitment(remittance_id), commitment);
}

/// Retrieves the payout commitment for a remittance, if any.
pub fn get_payout_commitment(env: &Env, remittance_id: u64) -> Option<soroban_sdk::BytesN<32>> {
    env.storage()
        .persistent()
        .get(&DataKey::PayoutCommitment(remittance_id))
}

// === Analytics Counters ===

/// Returns the total number of remittances ever created.
pub fn get_total_remittance_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::TotalRemittanceCount)
        .unwrap_or(0)
}

/// Increments the total remittance count by 1.
pub fn increment_remittance_count(env: &Env) -> Result<(), ContractError> {
    let current = get_total_remittance_count(env);
    let next = current.checked_add(1).ok_or(ContractError::Overflow)?;
    env.storage()
        .instance()
        .set(&DataKey::TotalRemittanceCount, &next);
    Ok(())
}

/// Returns the cumulative volume of completed remittances (original amounts, before fees).
pub fn get_total_completed_volume(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalCompletedVolume)
        .unwrap_or(0)
}

/// Adds `amount` to the cumulative completed volume.
pub fn add_completed_volume(env: &Env, amount: i128) -> Result<(), ContractError> {
    let current = get_total_completed_volume(env);
    let next = current.checked_add(amount).ok_or(ContractError::Overflow)?;
    env.storage()
        .instance()
        .set(&DataKey::TotalCompletedVolume, &next);
    Ok(())
}
