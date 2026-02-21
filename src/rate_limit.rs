use soroban_sdk::{contracttype, Address, Env};

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

/// Rate limit tracking per address
#[contracttype]
#[derive(Clone, Debug)]
struct RateLimitEntry {
    /// Number of requests in current window
    request_count: u32,
    /// Window start timestamp
    window_start: u64,
}

#[contracttype]
#[derive(Clone)]
enum RateLimitKey {
    /// Global rate limit configuration
    Config,
    /// Per-address rate limit tracking
    Entry(Address),
}

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

/// Check and update rate limit for an address
/// Returns Ok(()) if within limits, Err(ContractError::RateLimitExceeded) if exceeded
pub fn check_rate_limit(env: &Env, address: &Address) -> Result<(), ContractError> {
    let config = get_rate_limit_config(env);

    // If rate limiting is disabled, allow all requests
    if !config.enabled {
        return Ok(());
    }

    let current_time = env.ledger().timestamp();
    let key = RateLimitKey::Entry(address.clone());

    // Get or create rate limit entry
    let mut entry: RateLimitEntry = env
        .storage()
        .temporary()
        .get(&key)
        .unwrap_or(RateLimitEntry {
            request_count: 0,
            window_start: current_time,
        });

    // Check if we're in a new window
    let window_elapsed = current_time.saturating_sub(entry.window_start);
    if window_elapsed >= config.window_seconds {
        // Reset to new window
        entry.request_count = 1;
        entry.window_start = current_time;
    } else {
        // Same window - check limit
        if entry.request_count >= config.max_requests {
            return Err(ContractError::RateLimitExceeded);
        }
        entry.request_count = entry.request_count.saturating_add(1);
    }

    // Store updated entry with TTL
    let ttl = config.window_seconds.saturating_add(3600);
    env.storage()
        .temporary()
        .set(&key, &entry);
    env.storage()
        .temporary()
        .extend_ttl(&key, ttl as u32, ttl as u32);

    Ok(())
}

/// Get current rate limit status for an address
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

    // If window expired, return 0 requests
    if window_elapsed >= config.window_seconds {
        (0, config.max_requests, config.window_seconds)
    } else {
        (entry.request_count, config.max_requests, config.window_seconds)
    }
}
