//! Storage management for the SwiftRemit contract.
//!
//! This module provides functions for reading and writing contract state,
//! including configuration, remittance records, agent registration, and fee tracking.
//! Uses both instance storage (contract-level config) and persistent storage
//! (per-entity data).

use soroban_sdk::{contracttype, Address, Env, String, Vec};

use crate::{ContractError, Remittance, TransferRecord, DailyLimit};

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
    /// Contract administrator address with privileged access (deprecated - use AdminRole)
    Admin,

    /// Admin role status indexed by address (persistent storage)
    AdminRole(Address),

    /// Counter for tracking number of admins
    AdminCount,

    /// USDC token contract address used for all remittance transactions
    UsdcToken,

    /// Platform fee in basis points (1 bps = 0.01%)
    PlatformFeeBps,

    // === Remittance Management ===
    // Keys for tracking and storing remittance transactions
    /// Global counter for generating unique remittance IDs
    RemittanceCounter,

    /// Individual remittance record indexed by ID (persistent storage)
    Remittance(u64),

    // === Agent Management ===
    // Keys for tracking registered agents
    /// Agent registration status indexed by agent address (persistent storage)
    AgentRegistered(Address),

    // === Fee Tracking ===
    // Keys for managing platform fees
    /// Total accumulated platform fees awaiting withdrawal
    AccumulatedFees,

    /// Contract pause status for emergency halts
    Paused,

    // === Settlement Deduplication ===
    // Keys for preventing duplicate settlement execution
    /// Settlement hash for duplicate detection (persistent storage)
    SettlementHash(u64),
    
    // === Rate Limiting ===
    // Keys for preventing abuse through rate limiting
    /// Cooldown period in seconds between settlements per sender
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
    
    /// Settlement completion event emission tracking (persistent storage)
    /// Tracks whether the completion event has been emitted for a settlement
    SettlementEventEmitted(u64),
    
    /// Total number of successfully finalized settlements (instance storage)
    /// Incremented atomically each time a settlement is successfully completed
    SettlementCounter,
}

/// Checks if the contract has an admin configured.
///
/// # Arguments
///
/// * `env` - The contract execution environment
///
/// # Returns
///
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
pub fn has_settlement_hash(env: &Env, remittance_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::SettlementHash(remittance_id))
}

/// Marks a settlement as executed for duplicate prevention.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance_id` - Remittance ID to mark as settled
pub fn set_settlement_hash(env: &Env, remittance_id: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::SettlementHash(remittance_id), &true);
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

pub fn check_rate_limit(env: &Env, sender: &Address) -> Result<(), ContractError> {
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
    env.storage()
        .persistent()
        .get(&DataKey::SettlementEventEmitted(remittance_id))
        .unwrap_or(false)
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
    env.storage()
        .persistent()
        .set(&DataKey::SettlementEventEmitted(remittance_id), &true);
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
/// # Panics
///
/// Panics if the counter would overflow u64::MAX (extremely unlikely in practice)
///
/// # Guarantees
///
/// - Atomic: Increment and store happen together
/// - Internal-only: Not exposed as public contract function
/// - Deterministic: Always increments by exactly 1
/// - Consistent: Only called after successful finalization
pub fn increment_settlement_counter(env: &Env) {
    let current = get_settlement_counter(env);
    let new_count = current.checked_add(1).expect("Settlement counter overflow");
    env.storage()
        .instance()
        .set(&DataKey::SettlementCounter, &new_count);
}
