use soroban_sdk::{contracttype, Env};

use crate::storage::{get_accumulated_fees, get_remittance_counter, has_admin, is_paused};
use crate::circuit_breaker_storage::{get_active_pause_seq, get_pause_record_by_seq};
use crate::MaybePauseReason;

/// Health check response for contract monitoring.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HealthStatus {
    pub initialized: bool,
    pub paused: bool,
    pub pause_reason: MaybePauseReason,
    pub admin_count: u32,
    pub total_remittances: u64,
    pub accumulated_fees: i128,
}

/// Returns the current health status of the contract.
pub fn health(env: &Env) -> HealthStatus {
    let initialized = has_admin(env);
    let paused = is_paused(env);
    let admin_count = crate::storage::get_admin_count(env);
    let total_remittances = get_remittance_counter(env).unwrap_or(0);
    let accumulated_fees = get_accumulated_fees(env).unwrap_or(0);

    let pause_reason = if paused {
        get_active_pause_seq(env)
            .and_then(|seq| get_pause_record_by_seq(env, seq))
            .map(|r| MaybePauseReason::Some(r.reason))
            .unwrap_or(MaybePauseReason::None)
    } else {
        MaybePauseReason::None
    };

    HealthStatus {
        initialized,
        paused,
        pause_reason,
        admin_count,
        total_remittances,
        accumulated_fees,
    }
}
