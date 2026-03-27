use core::convert::TryInto;

use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::ContractError;

/// Rate limit configuration stored in instance storage
#[contracttype]
#[derive(Clone, Debug)]
pub struct RateLimitConfig {
    /// Maximum number of requests allowed per window
    pub max_requests: u32,
    /// Time window in seconds
    pub window_seconds: u64,
    /// Whether rate limiting is enabled
    pub enabled: bool,
}

/// Simple counter-based rate limit entry used by the global `check_rate_limit`.
/// Stored per-address in temporary storage.
#[contracttype]
#[derive(Clone, Debug)]
struct RateLimitEntry {
    /// Number of requests in current window
    request_count: u32,
    /// Window start timestamp
    window_start: u64,
}

/// Sliding-window rate limit entry used by `abuse_protection`.
/// Tracks individual request timestamps so stale ones can be evicted.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SlidingWindowEntry {
    /// Address being rate limited
    pub address: Address,
    /// Action type tag (opaque u32 so this module stays action-agnostic)
    pub action_tag: u32,
    /// Request timestamps within the current window
    pub timestamps: Vec<u64>,
    /// Window start time (updated on each check)
    pub window_start: u64,
    /// Total requests in current window
    pub request_count: u32,
}

#[contracttype]
#[derive(Clone)]
enum RateLimitKey {
    /// Global rate limit configuration
    Config,
    /// Per-address counter-based tracking
    Entry(Address),
    /// Per-(address, action_tag) sliding-window tracking
    Sliding(Address, u32),
}

// ═══════════════════════════════════════════════════════════════════════════
// Configuration helpers
// ═══════════════════════════════════════════════════════════════════════════

/// Initialize rate limiting with default configuration
pub fn init_rate_limit(env: &Env) {
    let config = RateLimitConfig {
        max_requests: 100,
        window_seconds: 60,
        enabled: true,
    };
    env.storage()
        .instance()
        .set(&RateLimitKey::Config, &config);
}

/// Get current rate limit configuration
pub fn get_rate_limit_config(env: &Env) -> RateLimitConfig {
    env.storage()
        .instance()
        .get(&RateLimitKey::Config)
        .unwrap_or(RateLimitConfig {
            max_requests: 100,
            window_seconds: 60,
            enabled: true,
        })
}

/// Update rate limit configuration (admin only)
pub fn set_rate_limit_config(env: &Env, config: RateLimitConfig) {
    env.storage()
        .instance()
        .set(&RateLimitKey::Config, &config);
}

// ═══════════════════════════════════════════════════════════════════════════
// Counter-based rate limit (global, used by contract entry-points)
// ═══════════════════════════════════════════════════════════════════════════

/// Check and update rate limit for an address.
/// Returns `Ok(())` if within limits, `Err(ContractError::RateLimitExceeded)` if exceeded.
pub fn check_rate_limit(env: &Env, address: &Address) -> Result<(), ContractError> {
    let config = get_rate_limit_config(env);

    if !config.enabled {
        return Ok(());
    }

    let current_time = env.ledger().timestamp();
    let key = RateLimitKey::Entry(address.clone());

    let mut entry: RateLimitEntry = env
        .storage()
        .temporary()
        .get(&key)
        .unwrap_or(RateLimitEntry {
            request_count: 0,
            window_start: current_time,
        });

    let window_elapsed = current_time.saturating_sub(entry.window_start);
    if window_elapsed >= config.window_seconds {
        entry.request_count = 1;
        entry.window_start = current_time;
    } else {
        if entry.request_count >= config.max_requests {
            return Err(ContractError::RateLimitExceeded);
        }
        entry.request_count = entry.request_count.saturating_add(1);
    }

    let ttl = config.window_seconds.saturating_add(3600);
    env.storage().temporary().set(&key, &entry);
    env.storage()
        .temporary()
        .extend_ttl(&key, ttl as u32, ttl as u32);

    Ok(())
}

/// Get current rate limit status for an address.
/// Returns `(current_requests, max_requests, window_seconds)`.
pub fn get_rate_limit_status(env: &Env, address: &Address) -> (u32, u32, u64) {
    let config = get_rate_limit_config(env);
    let key = RateLimitKey::Entry(address.clone());

    let entry: RateLimitEntry = env
        .storage()
        .temporary()
        .get(&key)
        .unwrap_or(RateLimitEntry {
            request_count: 0,
            window_start: env.ledger().timestamp(),
        });

    let current_time = env.ledger().timestamp();
    let window_elapsed = current_time.saturating_sub(entry.window_start);

    if window_elapsed >= config.window_seconds {
        (0, config.max_requests, config.window_seconds)
    } else {
        (entry.request_count, config.max_requests, config.window_seconds)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Sliding-window primitives (shared with abuse_protection)
// ═══════════════════════════════════════════════════════════════════════════

/// Load a `SlidingWindowEntry` for `(address, action_tag)` from temporary storage,
/// creating a default empty entry if none exists yet.
pub fn get_sliding_window_entry(
    env: &Env,
    address: &Address,
    action_tag: u32,
) -> SlidingWindowEntry {
    let key = RateLimitKey::Sliding(address.clone(), action_tag);
    env.storage()
        .temporary()
        .get(&key)
        .unwrap_or_else(|| SlidingWindowEntry {
            address: address.clone(),
            action_tag,
            timestamps: Vec::new(env),
            window_start: env.ledger().timestamp(),
            request_count: 0,
        })
}

/// Persist a `SlidingWindowEntry` with a TTL of `2 × window_seconds`.
pub fn save_sliding_window_entry(env: &Env, entry: &SlidingWindowEntry, window_seconds: u64) {
    let key = RateLimitKey::Sliding(entry.address.clone(), entry.action_tag);
    env.storage().temporary().set(&key, entry);
    let ttl: u32 = (window_seconds * 2).try_into().unwrap_or(u32::MAX);
    env.storage().temporary().extend_ttl(&key, ttl, ttl);
}

/// Return a new `Vec` containing only timestamps `>= window_start`.
pub fn filter_timestamps_in_window(env: &Env, timestamps: &Vec<u64>, window_start: u64) -> Vec<u64> {
    let mut filtered = Vec::new(env);
    for i in 0..timestamps.len() {
        let ts = timestamps.get_unchecked(i);
        if ts >= window_start {
            filtered.push_back(ts);
        }
    }
    filtered
}

/// Count timestamps `>= window_start` without allocating.
pub fn count_timestamps_in_window(timestamps: &Vec<u64>, window_start: u64) -> u32 {
    let mut count = 0u32;
    for i in 0..timestamps.len() {
        if timestamps.get_unchecked(i) >= window_start {
            count += 1;
        }
    }
    count
}
