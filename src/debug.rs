//! Debug logging module for SwiftRemit contract.
//!
//! This module provides conditional debug logging that is only enabled
//! when the "debug-log" feature flag is active.

use soroban_sdk::Env;

/// Debug log macro that only compiles and runs in debug builds.
///
/// # Usage
/// Enable the "debug-log" feature in Cargo.toml to activate debug logging:
/// ```toml
/// [features]
/// default = ["debug-log"]
/// debug-log = []
/// ```
///
/// Then use the macro in your code:
/// ```ignore
/// debug_log!(&env, "Transaction processed: {}", value);
/// ```
#[macro_export]
#[cfg(feature = "debug-log")]
macro_rules! debug_log {
    ($env:expr, $msg:expr) => {
        soroban_sdk::log!($env, $msg)
    };
    ($env:expr, $msg:expr, $($arg:tt)*) => {
        soroban_sdk::log!($env, $msg, $($arg)*)
    };
}

/// Debug log macro that compiles to nothing in release builds.
#[macro_export]
#[cfg(not(feature = "debug-log"))]
macro_rules! debug_log {
    ($env:expr, $msg:expr) => {};
    ($env:expr, $msg:expr, $($arg:tt)*) => {};
}

/// Logs contract initialization in debug mode.
#[cfg(feature = "debug-log")]
pub fn log_initialize(
    env: &Env,
    admin: &soroban_sdk::Address,
    usdc_token: &soroban_sdk::Address,
    fee_bps: u32,
) {
    soroban_sdk::log!(
        env,
        "Initialize: admin={}, usdc_token={}, fee_bps={}",
        admin,
        usdc_token,
        fee_bps
    );
}

/// Logs agent registration in debug mode.
#[cfg(feature = "debug-log")]
pub fn log_register_agent(env: &Env, agent: &soroban_sdk::Address) {
    soroban_sdk::log!(env, "Register agent: {}", agent);
}

/// Logs agent removal in debug mode.
#[cfg(feature = "debug-log")]
pub fn log_remove_agent(env: &Env, agent: &soroban_sdk::Address) {
    soroban_sdk::log!(env, "Remove agent: {}", agent);
}

/// Logs fee update in debug mode.
#[cfg(feature = "debug-log")]
pub fn log_update_fee(env: &Env, fee_bps: u32) {
    soroban_sdk::log!(env, "Update fee: fee_bps={}", fee_bps);
}

/// Logs remittance creation in debug mode.
#[cfg(feature = "debug-log")]
pub fn log_create_remittance(
    env: &Env,
    remittance_id: u64,
    sender: &soroban_sdk::Address,
    agent: &soroban_sdk::Address,
    amount: i128,
    fee: i128,
) {
    soroban_sdk::log!(
        env,
        "Create remittance: id={}, sender={}, agent={}, amount={}, fee={}",
        remittance_id,
        sender,
        agent,
        amount,
        fee
    );
}

/// Logs payout confirmation in debug mode.
#[cfg(feature = "debug-log")]
pub fn log_confirm_payout(env: &Env, remittance_id: u64, payout_amount: i128) {
    soroban_sdk::log!(
        env,
        "Confirm payout: remittance_id={}, payout_amount={}",
        remittance_id,
        payout_amount
    );
}

/// Logs remittance cancellation in debug mode.
#[cfg(feature = "debug-log")]
pub fn log_cancel_remittance(env: &Env, remittance_id: u64) {
    soroban_sdk::log!(env, "Cancel remittance: remittance_id={}", remittance_id);
}

/// Logs fee withdrawal in debug mode.
#[cfg(feature = "debug-log")]
pub fn log_withdraw_fees(env: &Env, to: &soroban_sdk::Address, fees: i128) {
    soroban_sdk::log!(env, "Withdraw fees: to={}, fees={}", to, fees);
}

/// Logs admin addition in debug mode.
#[cfg(feature = "debug-log")]
pub fn log_add_admin(env: &Env, caller: &soroban_sdk::Address, new_admin: &soroban_sdk::Address) {
    soroban_sdk::log!(env, "Add admin: caller={}, new_admin={}", caller, new_admin);
}

/// Logs admin removal in debug mode.
#[cfg(feature = "debug-log")]
pub fn log_remove_admin(
    env: &Env,
    caller: &soroban_sdk::Address,
    removed_admin: &soroban_sdk::Address,
) {
    soroban_sdk::log!(
        env,
        "Remove admin: caller={}, removed_admin={}",
        caller,
        removed_admin
    );
}

// Non-feature-gated stubs for compile-time compatibility

/// Logs contract initialization - no-op in release.
#[cfg(not(feature = "debug-log"))]
pub fn log_initialize(
    _env: &Env,
    _admin: &soroban_sdk::Address,
    _usdc_token: &soroban_sdk::Address,
    _fee_bps: u32,
) {
}

/// Logs agent registration - no-op in release.
#[cfg(not(feature = "debug-log"))]
pub fn log_register_agent(_env: &Env, _agent: &soroban_sdk::Address) {}

/// Logs agent removal - no-op in release.
#[cfg(not(feature = "debug-log"))]
pub fn log_remove_agent(_env: &Env, _agent: &soroban_sdk::Address) {}

/// Logs fee update - no-op in release.
#[cfg(not(feature = "debug-log"))]
pub fn log_update_fee(_env: &Env, _fee_bps: u32) {}

/// Logs remittance creation - no-op in release.
#[cfg(not(feature = "debug-log"))]
pub fn log_create_remittance(
    _env: &Env,
    _remittance_id: u64,
    _sender: &soroban_sdk::Address,
    _agent: &soroban_sdk::Address,
    _amount: i128,
    _fee: i128,
) {
}

/// Logs payout confirmation - no-op in release.
#[cfg(not(feature = "debug-log"))]
pub fn log_confirm_payout(_env: &Env, _remittance_id: u64, _payout_amount: i128) {}

/// Logs remittance cancellation - no-op in release.
#[cfg(not(feature = "debug-log"))]
pub fn log_cancel_remittance(_env: &Env, _remittance_id: u64) {}

/// Logs fee withdrawal - no-op in release.
#[cfg(not(feature = "debug-log"))]
pub fn log_withdraw_fees(_env: &Env, _to: &soroban_sdk::Address, _fees: i128) {}

/// Logs admin addition - no-op in release.
#[cfg(not(feature = "debug-log"))]
pub fn log_add_admin(
    _env: &Env,
    _caller: &soroban_sdk::Address,
    _new_admin: &soroban_sdk::Address,
) {
}

/// Logs admin removal - no-op in release.
#[cfg(not(feature = "debug-log"))]
pub fn log_remove_admin(_env: &Env, _caller: &soroban_sdk::Address, _removed_admin: &soroban_sdk::Address) {}


/// Logs token whitelist addition in debug mode.
#[cfg(feature = "debug-log")]
pub fn log_whitelist_token(env: &Env, token: &soroban_sdk::Address) {
    soroban_sdk::log!(env, "Whitelist token: {}", token);
}

/// Logs token whitelist removal in debug mode.
#[cfg(feature = "debug-log")]
pub fn log_remove_whitelisted_token(env: &Env, token: &soroban_sdk::Address) {
    soroban_sdk::log!(env, "Remove whitelisted token: {}", token);
}

/// Logs token whitelist addition - no-op in release.
#[cfg(not(feature = "debug-log"))]
pub fn log_whitelist_token(_env: &Env, _token: &soroban_sdk::Address) {}

/// Logs token whitelist removal - no-op in release.
#[cfg(not(feature = "debug-log"))]
pub fn log_remove_whitelisted_token(_env: &Env, _token: &soroban_sdk::Address) {}

/// Logs rate limit configuration update in debug mode.
#[cfg(feature = "debug-log")]
pub fn log_update_rate_limit(env: &Env, max_requests: u32, window_seconds: u64, enabled: bool) {
    soroban_sdk::log!(
        env,
        "Update rate limit: max_requests={}, window_seconds={}, enabled={}",
        max_requests,
        window_seconds,
        enabled
    );
}

/// Logs rate limit configuration update - no-op in release.
#[cfg(not(feature = "debug-log"))]
pub fn log_update_rate_limit(_env: &Env, _max_requests: u32, _window_seconds: u64, _enabled: bool) {}
