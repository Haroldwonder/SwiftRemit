use core::convert::TryInto;
use soroban_sdk::{contracttype, Address, Env};
use crate::errors::ContractError;
use crate::rate_limit::{
    filter_timestamps_in_window, count_timestamps_in_window,
    get_sliding_window_entry, save_sliding_window_entry,
};

pub const RATE_LIMIT_WINDOW: u64 = 60;
pub const MAX_TRANSFERS_PER_WINDOW: u32 = 10;
pub const MAX_CANCELLATIONS_PER_WINDOW: u32 = 5;
pub const MAX_QUERIES_PER_WINDOW: u32 = 100;
pub const TRANSFER_COOLDOWN: u64 = 5;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ActionType {
    Transfer,
    Cancellation,
    Settlement,
    Query,
    Admin,
}

fn action_tag(action_type: &ActionType) -> u32 {
    match action_type {
        ActionType::Transfer     => 0,
        ActionType::Cancellation => 1,
        ActionType::Settlement   => 2,
        ActionType::Query        => 3,
        ActionType::Admin        => 4,
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CooldownEntry {
    pub address: Address,
    pub action_type: ActionType,
    pub last_action_time: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SuspiciousActivityLog {
    pub address: Address,
    pub activity_type: SuspiciousActivityType,
    pub timestamp: u64,
    pub details: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SuspiciousActivityType {
    RateLimitExceeded,
    RapidRetries,
    FailedAuth,
    UnusualPattern,
    CooldownViolation,
}

pub fn check_rate_limit(
    env: &Env,
    address: &Address,
    action_type: ActionType,
) -> Result<(), ContractError> {
    if action_type == ActionType::Admin {
        return Ok(());
    }
    let current_time = env.ledger().timestamp();
    let max_requests = get_max_requests_for_action(&action_type);
    let tag = action_tag(&action_type);
    let mut entry = get_sliding_window_entry(env, address, tag);
    let window_start = current_time.saturating_sub(RATE_LIMIT_WINDOW);
    entry.timestamps = filter_timestamps_in_window(env, &entry.timestamps, window_start);
    entry.request_count = entry.timestamps.len();
    entry.window_start = window_start;
    if entry.request_count >= max_requests {
        log_suspicious_activity(env, address, SuspiciousActivityType::RateLimitExceeded, entry.request_count);
        emit_rate_limit_exceeded(env, address, &action_type, entry.request_count);
        return Err(ContractError::RateLimitExceeded);
    }
    entry.timestamps.push_back(current_time);
    entry.request_count += 1;
    save_sliding_window_entry(env, &entry, RATE_LIMIT_WINDOW);
    Ok(())
}

pub fn check_cooldown(
    env: &Env,
    address: &Address,
    action_type: ActionType,
) -> Result<(), ContractError> {
    let cooldown_period = get_cooldown_period(&action_type);
    if cooldown_period == 0 {
        return Ok(());
    }
    let current_time = env.ledger().timestamp();
    if let Some(entry) = get_cooldown_entry(env, address, &action_type) {
        let time_since_last = current_time.saturating_sub(entry.last_action_time);
        if time_since_last < cooldown_period {
            log_suspicious_activity(env, address, SuspiciousActivityType::CooldownViolation, time_since_last as u32);
            emit_cooldown_violation(env, address, &action_type, time_since_last);
            return Err(ContractError::CooldownActive);
        }
    }
    Ok(())
}

pub fn record_action(env: &Env, address: &Address, action_type: ActionType) {
    let current_time = env.ledger().timestamp();
    let cooldown_entry = CooldownEntry {
        address: address.clone(),
        action_type: action_type.clone(),
        last_action_time: current_time,
    };
    save_cooldown_entry(env, &cooldown_entry);
    emit_action_recorded(env, address, &action_type, current_time);
}

pub fn detect_rapid_retries(
    env: &Env,
    address: &Address,
    action_type: &ActionType,
    threshold: u32,
    time_window: u64,
) -> bool {
    let tag = action_tag(action_type);
    let entry = get_sliding_window_entry(env, address, tag);
    let window_start = env.ledger().timestamp().saturating_sub(time_window);
    let recent_requests = count_timestamps_in_window(&entry.timestamps, window_start);
    if recent_requests >= threshold {
        log_suspicious_activity(env, address, SuspiciousActivityType::RapidRetries, recent_requests);
        emit_rapid_retries(env, address, action_type, recent_requests);
        return true;
    }
    false
}

fn get_max_requests_for_action(action_type: &ActionType) -> u32 {
    match action_type {
        ActionType::Transfer     => MAX_TRANSFERS_PER_WINDOW,
        ActionType::Cancellation => MAX_CANCELLATIONS_PER_WINDOW,
        ActionType::Settlement   => MAX_TRANSFERS_PER_WINDOW,
        ActionType::Query        => MAX_QUERIES_PER_WINDOW,
        ActionType::Admin        => u32::MAX,
    }
}

fn get_cooldown_period(action_type: &ActionType) -> u64 {
    match action_type {
        ActionType::Transfer   => TRANSFER_COOLDOWN,
        ActionType::Settlement => TRANSFER_COOLDOWN,
        _                      => 0,
    }
}

fn get_cooldown_entry(env: &Env, address: &Address, action_type: &ActionType) -> Option<CooldownEntry> {
    env.storage().temporary().get(&create_cooldown_key(address, action_type))
}

fn save_cooldown_entry(env: &Env, entry: &CooldownEntry) {
    let key = create_cooldown_key(&entry.address, &entry.action_type);
    env.storage().temporary().set(&key, entry);
    let cooldown_period = get_cooldown_period(&entry.action_type);
    let ttl: u32 = (cooldown_period * 2).try_into().unwrap_or(u32::MAX);
    env.storage().temporary().extend_ttl(&key, ttl, ttl);
}

fn create_cooldown_key(address: &Address, action_type: &ActionType) -> (Address, ActionType, u32) {
    (address.clone(), action_type.clone(), 1)
}

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
    let key = (address.clone(), env.ledger().timestamp());
    env.storage().temporary().set(&key, &log_entry);
    env.storage().temporary().extend_ttl(&key, 86400, 86400);
}

fn emit_rate_limit_exceeded(env: &Env, address: &Address, action_type: &ActionType, request_count: u32) {
    env.events().publish(
        (soroban_sdk::symbol_short!("abuse"), soroban_sdk::symbol_short!("ratelimit")),
        (env.ledger().sequence(), env.ledger().timestamp(), address, action_type.clone(), request_count),
    );
}

fn emit_cooldown_violation(env: &Env, address: &Address, action_type: &ActionType, time_since_last: u64) {
    env.events().publish(
        (soroban_sdk::symbol_short!("abuse"), soroban_sdk::symbol_short!("cooldown")),
        (env.ledger().sequence(), env.ledger().timestamp(), address, action_type.clone(), time_since_last),
    );
}

fn emit_rapid_retries(env: &Env, address: &Address, action_type: &ActionType, retry_count: u32) {
    env.events().publish(
        (soroban_sdk::symbol_short!("abuse"), soroban_sdk::symbol_short!("retries")),
        (env.ledger().sequence(), env.ledger().timestamp(), address, action_type.clone(), retry_count),
    );
}

fn emit_action_recorded(env: &Env, address: &Address, action_type: &ActionType, timestamp: u64) {
    env.events().publish(
        (soroban_sdk::symbol_short!("action"), soroban_sdk::symbol_short!("recorded")),
        (env.ledger().sequence(), timestamp, address, action_type.clone()),
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
        env.as_contract(&contract_id, || {
            for _ in 0..MAX_TRANSFERS_PER_WINDOW {
                assert!(check_rate_limit(&env, &address, ActionType::Transfer).is_ok());
            }
        });
    }

    #[test]
    fn test_rate_limit_blocks_excess_requests() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address = Address::generate(&env);
        env.as_contract(&contract_id, || {
            for _ in 0..MAX_TRANSFERS_PER_WINDOW {
                check_rate_limit(&env, &address, ActionType::Transfer).unwrap();
            }
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
        env.as_contract(&contract_id, || {
            assert!(check_cooldown(&env, &address, ActionType::Transfer).is_ok());
            record_action(&env, &address, ActionType::Transfer);
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
        env.as_contract(&contract_id, || {
            for _ in 0..MAX_TRANSFERS_PER_WINDOW {
                check_rate_limit(&env, &address1, ActionType::Transfer).unwrap();
            }
            assert!(check_rate_limit(&env, &address1, ActionType::Transfer).is_err());
            assert!(check_rate_limit(&env, &address2, ActionType::Transfer).is_ok());
        });
    }

    #[test]
    fn test_different_action_types_independent_limits() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address = Address::generate(&env);
        env.as_contract(&contract_id, || {
            for _ in 0..MAX_TRANSFERS_PER_WINDOW {
                check_rate_limit(&env, &address, ActionType::Transfer).unwrap();
            }
            assert!(check_rate_limit(&env, &address, ActionType::Transfer).is_err());
            assert!(check_rate_limit(&env, &address, ActionType::Cancellation).is_ok());
        });
    }

    #[test]
    fn test_rapid_retry_detection() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address = Address::generate(&env);
        env.as_contract(&contract_id, || {
            for _ in 0..5 {
                let _ = check_rate_limit(&env, &address, ActionType::Transfer);
            }
            assert!(detect_rapid_retries(&env, &address, &ActionType::Transfer, 3, 10));
        });
    }

    #[test]
    fn test_cooldown_expires_at_ledger_boundary() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address = Address::generate(&env);
        env.as_contract(&contract_id, || {
            // Record action at t=0 (default ledger timestamp)
            record_action(&env, &address, ActionType::Transfer);

            // One second before cooldown expires: still blocked
            env.ledger().with_mut(|l| l.timestamp = TRANSFER_COOLDOWN - 1);
            assert_eq!(
                check_cooldown(&env, &address, ActionType::Transfer).unwrap_err(),
                ContractError::CooldownActive,
                "cooldown should still be active one second before expiry"
            );

            // Exactly at cooldown boundary: still blocked (time_since_last == cooldown_period - 1 < cooldown_period)
            env.ledger().with_mut(|l| l.timestamp = TRANSFER_COOLDOWN);
            // time_since_last = TRANSFER_COOLDOWN - 0 = TRANSFER_COOLDOWN, which is NOT < cooldown_period
            // so this should be allowed
            assert!(
                check_cooldown(&env, &address, ActionType::Transfer).is_ok(),
                "cooldown should be expired exactly at the boundary"
            );

            // After cooldown: allowed
            env.ledger().with_mut(|l| l.timestamp = TRANSFER_COOLDOWN + 1);
            assert!(
                check_cooldown(&env, &address, ActionType::Transfer).is_ok(),
                "cooldown should be expired after the boundary"
            );
        });
    }

    #[test]
    fn test_admin_actions_no_rate_limit() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address = Address::generate(&env);
        env.as_contract(&contract_id, || {
            for _ in 0..1000 {
                assert!(check_rate_limit(&env, &address, ActionType::Admin).is_ok());
            }
        });
    }

    #[test]
    fn test_query_actions_higher_limit() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let address = Address::generate(&env);
        env.as_contract(&contract_id, || {
            for _ in 0..MAX_QUERIES_PER_WINDOW {
                assert!(check_rate_limit(&env, &address, ActionType::Query).is_ok());
            }
            assert!(check_rate_limit(&env, &address, ActionType::Query).is_err());
        });
    }
}
