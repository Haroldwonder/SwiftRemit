use soroban_sdk::{contracttype, Address, Env};

use crate::{ContractError, Remittance};

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
    /// Contract administrator address with privileged access
    Admin,

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
}

pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(ContractError::NotInitialized)
}

pub fn set_usdc_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::UsdcToken, token);
}

pub fn get_usdc_token(env: &Env) -> Result<Address, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::UsdcToken)
        .ok_or(ContractError::NotInitialized)
}

pub fn set_platform_fee_bps(env: &Env, fee_bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::PlatformFeeBps, &fee_bps);
}

pub fn get_platform_fee_bps(env: &Env) -> Result<u32, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::PlatformFeeBps)
        .ok_or(ContractError::NotInitialized)
}

pub fn set_remittance_counter(env: &Env, counter: u64) {
    env.storage()
        .instance()
        .set(&DataKey::RemittanceCounter, &counter);
}

pub fn get_remittance_counter(env: &Env) -> Result<u64, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::RemittanceCounter)
        .ok_or(ContractError::NotInitialized)
}

pub fn set_remittance(env: &Env, id: u64, remittance: &Remittance) {
    env.storage()
        .persistent()
        .set(&DataKey::Remittance(id), remittance);
}

pub fn get_remittance(env: &Env, id: u64) -> Result<Remittance, ContractError> {
    env.storage()
        .persistent()
        .get(&DataKey::Remittance(id))
        .ok_or(ContractError::RemittanceNotFound)
}

pub fn set_agent_registered(env: &Env, agent: &Address, registered: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::AgentRegistered(agent.clone()), &registered);
}

pub fn is_agent_registered(env: &Env, agent: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::AgentRegistered(agent.clone()))
        .unwrap_or(false)
}

pub fn set_accumulated_fees(env: &Env, fees: i128) {
    env.storage()
        .instance()
        .set(&DataKey::AccumulatedFees, &fees);
}

pub fn get_accumulated_fees(env: &Env) -> Result<i128, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::AccumulatedFees)
        .ok_or(ContractError::NotInitialized)
}

pub fn has_settlement_hash(env: &Env, remittance_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::SettlementHash(remittance_id))
}

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
