//! Abuse Protection Module for SwiftRemit Contract
//!
//! This module implements comprehensive abuse protection mechanisms to safeguard
//! the financial infrastructure against transfer spamming, brute-force attempts,
//! and general API abuse.
//!
//! # Features
//!
//! - User-based rate limiting (per address)
//! - Action-based throttling (per operation type)
//! - Sliding window rate limiting
//! - Cooldown periods between operations
//! - Structured logging via events
//! - Monitoring hooks for suspicious activity
//!
//! # Note on Smart Contract Context
//!
//! Unlike traditional web APIs, smart contracts don't have access to:
//! - IP addresses (blockchain abstraction)
//! - External databases like Redis
//! - HTTP request context
//!
//! Instead, this implementation uses:
//! - Address-based identification (wallet addresses)
//! - On-chain storage for rate limit counters
//! - Blockchain events for logging and monitoring

use core::convert::TryInto;

use soroban_sdk::{contracttype, Address, Env, Map, Vec};
use crate::errors::ContractError;

/// Time window for rate limiting (in seconds)
pub const RATE_LIMIT_WINDOW: u64 = 60; // 1 minute

/// Maximum requests per window for different action types
pub const MAX_TRANSFERS_PER_WINDOW: u32 = 10;
pub const MAX_CANCELLATIONS_PER_WINDOW: u32 = 5;
pub const MAX_QUERIES_PER_WINDOW: u32 = 100;

/// Cooldown period between high-value operations (in seconds)
pub const TRANSFER_COOLDOWN: u64 = 5; // 5 seconds between transfers

/// Action types for rate limiting
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ActionType {
    /// Transfer/remittance creation
    Transfer,
    /// Remittance cancellation
    Cancellation,
    /// Settlement confirmation
    Settlement,
    /// Query operations (read-only)
    Query,
    /// Admin operations
    Admin,
}

/// Rate limit entry tracking requests in a time window
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RateLimitEntry {
    /// Address being rate limited
    pub address: Address,
    /// Action type
    pub action_type: ActionType,
    /// Request timestamps within the current window
    pub timestamps: Vec<u64>,
    /// Window start time
    pub window_start: u64,
    /// Total requests in current window
    pub request_count: u32,
}

/// Cooldown entry for enforcing delays between operations
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CooldownEntry {
    /// Address in cooldown
    pub address: Address,
    /// Action type
    pub action_type: ActionType,
    /// Last action timestamp
    pub last_action_time: u64,
}

/// Suspicious activity log entry
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SuspiciousActivityLog {
    /// Address involved
    pub address: Address,
    /// Activity type
    pub activity_type: SuspiciousActivityType,
    /// Timestamp
    pub timestamp: u64,
    /// Additional context
    pub details: u32,
}

/// Types of suspicious activity
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SuspiciousActivityType {
    /// Rate limit exceeded
    RateLimitExceeded,
    /// Rapid retry attempts
    RapidRetries,
    /// Failed authentication
    FailedAuth,
    /// Unusual pattern detected
    UnusualPattern,
    /// Cooldown violation
    CooldownViolation,
}

/// Checks if an address can perform an action based on rate limits.
///
/// Uses a sliding window approach to track requests over time.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `address` - The address attempting the action
/// * `action_type` - The type of action being attempted
///
/// # Returns
///
/// * `Ok(())` - Action is allowed
/// * `Err(ContractError::RateLimitExceeded)` - Rate limit exceeded
///
/// # Rate Limits
///
/// - Transfers: 10 per minute
/// - Cancellations: 5 per minute
/// - Queries: 100 per minute
/// - Settlements: 10 per minute
/// - Admin: No limit (but requires admin auth)
pub fn check_rate_limit(
    env: &Env,
    address: &Address,
    action_type: ActionType,
) -> Result<(), ContractError> {
    let current_time = env.ledger().timestamp();
    
    // Get max requests for this action type
    let max_requests = get_max_requests_for_action(&action_type);
    
    // Admin actions have no rate limit (auth is checked separately)
    if action_type == ActionType::Admin {
        return Ok(());
    }
    
    // Get or create rate limit entry
    let mut entry = get_rate_limit_entry(env, address, &action_type);
    
    // Clean up old timestamps outside the window
    let window_start = current_time.saturating_sub(RATE_LIMIT_WINDOW);
    entry.timestamps = filter_timestamps_in_window(env, &entry.timestamps, window_start);
    entry.request_count = entry.timestamps.len();
    entry.window_start = window_start;
    
    // Check if limit exceeded
    if entry.request_count >= max_requests {
        // Log suspicious activity
        log_suspicious_activity(
            env,
            address,
            SuspiciousActivityType::RateLimitExceeded,
            entry.request_count,
        );
        
        // Emit rate limit exceeded event
        emit_rate_limit_exceeded(env, address, &action_type, entry.request_count);
        
        return Err(ContractError::RateLimitExceeded);
    }
    
    // Add current timestamp
    entry.timestamps.push_back(current_time);
    entry.request_count += 1;
    
    // Save updated entry
    save_rate_limit_entry(env, &entry);
    
    Ok(())
}

/// Checks if an address is in cooldown for a specific action.
///
/// Enforces minimum time delays between high-value operations.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `address` - The address attempting the action
/// * `action_type` - The type of action being attempted
///
/// # Returns
///
/// * `Ok(())` - No cooldown, action is allowed
/// * `Err(ContractError::CooldownActive)` - Still in cooldown period
pub fn check_cooldown(
    env: &Env,
    address: &Address,
    action_type: ActionType,
) -> Result<(), ContractError> {
    let current_time = env.ledger().timestamp();
    
    // Get cooldown period for this action type
    let cooldown_period = get_cooldown_period(&action_type);
    
    // No cooldown for this action type
    if cooldown_period == 0 {
        return Ok(());
    }
    
    // Check if address has a cooldown entry
    if let Some(entry) = get_cooldown_entry(env, address, &action_type) {
        let time_since_last = current_time.saturating_sub(entry.last_action_time);
        
        if time_since_last < cooldown_period {
            // Log cooldown violation
            log_suspicious_activity(
                env,
                address,
                SuspiciousActivityType::CooldownViolation,
                time_since_last as u32,
            );
            
            // Emit cooldown violation event
            emit_cooldown_violation(env, address, &action_type, time_since_last);
            
            return Err(ContractError::CooldownActive);
        }
    }
    
    Ok(())
}

/// Records an action for rate limiting and cooldown tracking.
///
/// Should be called after an action is successfully performed.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `address` - The address that performed the action
/// * `action_type` - The type of action performed
pub fn record_action(env: &Env, address: &Address, action_type: ActionType) {
    let current_time = env.ledger().timestamp();
    
    // Update cooldown entry
    let cooldown_entry = CooldownEntry {
        address: address.clone(),
        action_type: action_type.clone(),
        last_action_time: current_time,
    };
    save_cooldown_entry(env, &cooldown_entry);
    
    // Emit action recorded event for monitoring
    emit_action_recorded(env, address, &action_type, current_time);
}

/// Detects rapid retry attempts (potential brute-force).
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `address` - The address to check
/// * `action_type` - The type of action
/// * `threshold` - Number of attempts to consider suspicious
/// * `time_window` - Time window in seconds
///
/// # Returns
///
/// * `true` - Rapid retries detected
/// * `false` - Normal activity
pub fn detect_rapid_retries(
    env: &Env,
    address: &Address,
    action_type: &ActionType,
    threshold: u32,
    time_window: u64,
) -> bool {
    let entry = get_rate_limit_entry(env, address, action_type);
    let current_time = env.ledger().timestamp();
    let window_start = current_time.saturating_sub(time_window);
    
    // Count requests in the time window
    let recent_requests = count_timestamps_in_window(&entry.timestamps, window_start);
    
    if recent_requests >= threshold {
        // Log rapid retries
        log_suspicious_activity(
            env,
            address,
            SuspiciousActivityType::RapidRetries,
            recent_requests,
        );
        
        // Emit rapid retry event
        emit_rapid_retries(env, address, action_type, recent_requests);
        
        return true;
    }
    
    false
}

/// Gets the maximum requests allowed for an action type.
fn get_max_requests_for_action(action_type: &ActionType) -> u32 {
    match action_type {
        ActionType::Transfer => MAX_TRANSFERS_PER_WINDOW,
        ActionType::Cancellation => MAX_CANCELLATIONS_PER_WINDOW,
        ActionType::Settlement => MAX_TRANSFERS_PER_WINDOW,
        ActionType::Query => MAX_QUERIES_PER_WINDOW,
        ActionType::Admin => u32::MAX, // No limit (auth checked separately)
    }
}

/// Gets the cooldown period for an action type.
fn get_cooldown_period(action_type: &ActionType) -> u64 {
    match action_type {
        ActionType::Transfer => TRANSFER_COOLDOWN,
        ActionType::Settlement => TRANSFER_COOLDOWN,
        ActionType::Cancellation => 0, // No cooldown
        ActionType::Query => 0,        // No cooldown
        ActionType::Admin => 0,        // No cooldown
    }
}

/// Filters timestamps to only include those within the window.
fn filter_timestamps_in_window(env: &Env, timestamps: &Vec<u64>, window_start: u64) -> Vec<u64> {
    let mut filtered = Vec::new(env);
    
    for i in 0..timestamps.len() {
        let timestamp = timestamps.get_unchecked(i);
        if timestamp >= window_start {
            filtered.push_back(timestamp);
        }
    }
    
    filtered
}

/// Counts timestamps within a time window.
fn count_timestamps_in_window(timestamps: &Vec<u64>, window_start: u64) -> u32 {
    let mut count = 0;
    
    for i in 0..timestamps.len() {
        let timestamp = timestamps.get_unchecked(i);
        if timestamp >= window_start {
            count += 1;
        }
    }
    
    count
}

// ═══════════════════════════════════════════════════════════════════════════
// Storage Functions
// ═══════════════════════════════════════════════════════════════════════════

/// Gets a rate limit entry for an address and action type.
fn get_rate_limit_entry(env: &Env, address: &Address, action_type: &ActionType) -> RateLimitEntry {
    let key = create_rate_limit_key(address, action_type);
    
    env.storage()
        .temporary()
        .get(&key)
        .unwrap_or_else(|| RateLimitEntry {
            address: address.clone(),
            action_type: action_type.clone(),
            timestamps: Vec::new(env),
            window_start: env.ledger().timestamp(),
            request_count: 0,
        })
}

/// Saves a rate limit entry.
fn save_rate_limit_entry(env: &Env, entry: &RateLimitEntry) {
    let key = create_rate_limit_key(&entry.address, &entry.action_type);
    
    // Store in temporary storage with TTL of 2x window size
    env.storage()
        .temporary()
        .set(&key, entry);
    
    // Extend TTL to 2x window size
    let ttl = (RATE_LIMIT_WINDOW * 2)
        .try_into()
        .unwrap_or(u32::MAX);
    env.storage().temporary().extend_ttl(&key, ttl, ttl);
}

/// Gets a cooldown entry for an address and action type.
fn get_cooldown_entry(
    env: &Env,
    address: &Address,
    action_type: &ActionType,
) -> Option<CooldownEntry> {
    let key = create_cooldown_key(address, action_type);
    env.storage().temporary().get(&key)
}

/// Saves a cooldown entry.
fn save_cooldown_entry(env: &Env, entry: &CooldownEntry) {
    let key = create_cooldown_key(&entry.address, &entry.action_type);
    
    // Store in temporary storage with TTL of cooldown period
    env.storage()
        .temporary()
        .set(&key, entry);
    
    let cooldown_period = get_cooldown_period(&entry.action_type);
    let ttl = (cooldown_period * 2)
        .try_into()
        .unwrap_or(u32::MAX);
    env.storage().temporary().extend_ttl(&key, ttl, ttl);
}

/// Creates a storage key for rate limit entries.
fn create_rate_limit_key(address: &Address, action_type: &ActionType) -> (Address, ActionType) {
    (address.clone(), action_type.clone())
}

/// Creates a storage key for cooldown entries.
fn create_cooldown_key(address: &Address, action_type: &ActionType) -> (Address, ActionType, u32) {
    (address.clone(), action_type.clone(), 1) // 1 = cooldown marker
}

// ═══════════════════════════════════════════════════════════════════════════
// Logging and Monitoring Functions
// ═══════════════════════════════════════════════════════════════════════════

/// Logs suspicious activity for monitoring.
fn log_suspicious_activity(
    env: &Env,
    address: &Address,
    activity_type: SuspiciousActivityType,
    details: u32,
) {
    let log_entry = SuspiciousActivityLog {
        address: address.clone(),
        activity_type,
        timestamp: env.ledger().timestamp(),
        details,
    };
    
    // Store in temporary storage for monitoring
    let key = (address.clone(), env.ledger().timestamp());
    env.storage().temporary().set(&key, &log_entry);
    env.storage().temporary().extend_ttl(&key, 86400, 86400); // 24 hours
}

/// Emits an event when rate limit is exceeded.
fn emit_rate_limit_exceeded(
    env: &Env,
    address: &Address,
    action_type: &ActionType,
    request_count: u32,
) {
    env.events().publish(
        (soroban_sdk::symbol_short!("abuse"), soroban_sdk::symbol_short!("ratelimit")),
        (
            env.ledger().sequence(),
            env.ledger().timestamp(),
            address,
            action_type.clone(),
            request_count,
        ),
    );
}

/// Emits an event when cooldown is violated.
fn emit_cooldown_violation(
    env: &Env,
    address: &Address,
    action_type: &ActionType,
    time_since_last: u64,
) {
    env.events().publish(
        (soroban_sdk::symbol_short!("abuse"), soroban_sdk::symbol_short!("cooldown")),
        (
            env.ledger().sequence(),
            env.ledger().timestamp(),
            address,
            action_type.clone(),
            time_since_last,
        ),
    );
}

/// Emits an event when rapid retries are detected.
fn emit_rapid_retries(
    env: &Env,
    address: &Address,
    action_type: &ActionType,
    retry_count: u32,
) {
    env.events().publish(
        (soroban_sdk::symbol_short!("abuse"), soroban_sdk::symbol_short!("retries")),
        (
            env.ledger().sequence(),
            env.ledger().timestamp(),
            address,
            action_type.clone(),
            retry_count,
        ),
    );
}

/// Emits an event when an action is recorded.
fn emit_action_recorded(
    env: &Env,
    address: &Address,
    action_type: &ActionType,
    timestamp: u64,
) {
    env.events().publish(
        (soroban_sdk::symbol_short!("action"), soroban_sdk::symbol_short!("recorded")),
        (
            env.ledger().sequence(),
            timestamp,
            address,
            action_type.clone(),
        ),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SwiftRemitContract;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_rate_limit_allows_within_limit() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address = Address::generate(&env);
        
        // Should allow up to MAX_TRANSFERS_PER_WINDOW requests
        env.as_contract(&contract_id, || {
            for _ in 0..MAX_TRANSFERS_PER_WINDOW {
                let result = check_rate_limit(&env, &address, ActionType::Transfer);
                assert!(result.is_ok());
            }
        });
    }

    #[test]
    fn test_rate_limit_blocks_excess_requests() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address = Address::generate(&env);
        
        // Fill up the limit
        env.as_contract(&contract_id, || {
            for _ in 0..MAX_TRANSFERS_PER_WINDOW {
                check_rate_limit(&env, &address, ActionType::Transfer).unwrap();
            }

            // Next request should be blocked
            let result = check_rate_limit(&env, &address, ActionType::Transfer);
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), ContractError::RateLimitExceeded);
        });
    }

    #[test]
    fn test_cooldown_enforced() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address = Address::generate(&env);
        
        // First action should succeed
        env.as_contract(&contract_id, || {
            assert!(check_cooldown(&env, &address, ActionType::Transfer).is_ok());
            record_action(&env, &address, ActionType::Transfer);

            // Immediate retry should fail
            let result = check_cooldown(&env, &address, ActionType::Transfer);
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), ContractError::CooldownActive);
        });
    }

    #[test]
    fn test_different_addresses_independent_limits() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address1 = Address::generate(&env);
        let address2 = Address::generate(&env);
        
        // Fill limit for address1
        env.as_contract(&contract_id, || {
            for _ in 0..MAX_TRANSFERS_PER_WINDOW {
                check_rate_limit(&env, &address1, ActionType::Transfer).unwrap();
            }

            // address1 should be blocked
            assert!(check_rate_limit(&env, &address1, ActionType::Transfer).is_err());

            // address2 should still be allowed
            assert!(check_rate_limit(&env, &address2, ActionType::Transfer).is_ok());
        });
    }

    #[test]
    fn test_different_action_types_independent_limits() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address = Address::generate(&env);
        
        // Fill transfer limit
        env.as_contract(&contract_id, || {
            for _ in 0..MAX_TRANSFERS_PER_WINDOW {
                check_rate_limit(&env, &address, ActionType::Transfer).unwrap();
            }

            // Transfer should be blocked
            assert!(check_rate_limit(&env, &address, ActionType::Transfer).is_err());

            // Cancellation should still be allowed (different limit)
            assert!(check_rate_limit(&env, &address, ActionType::Cancellation).is_ok());
        });
    }

    #[test]
    fn test_rapid_retry_detection() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address = Address::generate(&env);
        
        // Make rapid requests
        env.as_contract(&contract_id, || {
            for _ in 0..5 {
                let _ = check_rate_limit(&env, &address, ActionType::Transfer);
            }

            // Should detect rapid retries
            let is_rapid = detect_rapid_retries(&env, &address, &ActionType::Transfer, 3, 10);
            assert!(is_rapid);
        });
    }

    #[test]
    fn test_admin_actions_no_rate_limit() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address = Address::generate(&env);
        
        // Admin actions should never be rate limited
        env.as_contract(&contract_id, || {
            for _ in 0..1000 {
                let result = check_rate_limit(&env, &address, ActionType::Admin);
                assert!(result.is_ok());
            }
        });
    }

    #[test]
    fn test_query_actions_higher_limit() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address = Address::generate(&env);
        
        // Queries have higher limit (100 vs 10 for transfers)
        env.as_contract(&contract_id, || {
            for _ in 0..MAX_QUERIES_PER_WINDOW {
                let result = check_rate_limit(&env, &address, ActionType::Query);
                assert!(result.is_ok());
            }

            // Should block after limit
            let result = check_rate_limit(&env, &address, ActionType::Query);
            assert!(result.is_err());
        });
    }
}
