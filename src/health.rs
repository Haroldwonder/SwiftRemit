use soroban_sdk::{contracttype, Env};

use crate::storage::{get_admin_count, get_accumulated_fees, get_remittance_counter, has_admin, is_paused};

/// Health check response for contract monitoring.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HealthStatus {
    pub initialized: bool,
    pub paused: bool,
    pub admin_count: u32,
    pub total_remittances: u64,
    pub accumulated_fees: i128,
}

/// Returns the current health status of the contract.
pub fn health(env: &Env) -> HealthStatus {
    let initialized = has_admin(env);
    let paused = is_paused(env);
    let admin_count = get_admin_count(env).unwrap_or(0);
    let total_remittances = get_remittance_counter(env).unwrap_or(0);
    let accumulated_fees = get_accumulated_fees(env).unwrap_or(0);

    HealthStatus {
        initialized,
        paused,
        admin_count,
        total_remittances,
        accumulated_fees,
    }
}
