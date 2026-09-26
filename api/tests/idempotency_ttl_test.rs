//! Unit tests for idempotency TTL configuration (task 9.2).
//!
//! These tests exercise the TTL configuration surface used by the
//! idempotency protection layer for `create_remittance`. They verify that
//! TTL values are parsed, defaulted, and bounded as expected so that
//! retried transfer requests with the same idempotency key are deduplicated
//! for the intended window.

use std::time::Duration;

use api::idempotency::{IdempotencyConfig, DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS, MIN_TTL_SECONDS};

#[test]
fn default_ttl_is_used_when_unset() {
    let config = IdempotencyConfig::default();
    assert_eq!(config.ttl(), Duration::from_secs(DEFAULT_TTL_SECONDS));
}

#[test]
fn ttl_is_read_from_configured_seconds() {
    let config = IdempotencyConfig::new(600);
    assert_eq!(config.ttl(), Duration::from_secs(600));
}

#[test]
fn ttl_below_minimum_is_clamped() {
    let config = IdempotencyConfig::new(0);
    assert_eq!(config.ttl(), Duration::from_secs(MIN_TTL_SECONDS));
}

#[test]
fn ttl_above_maximum_is_clamped() {
    let config = IdempotencyConfig::new(u64::MAX);
    assert_eq!(config.ttl(), Duration::from_secs(MAX_TTL_SECONDS));
}

#[test]
fn ttl_within_bounds_is_preserved() {
    let config = IdempotencyConfig::new(MIN_TTL_SECONDS + 1);
    assert_eq!(config.ttl(), Duration::from_secs(MIN_TTL_SECONDS + 1));

    let config = IdempotencyConfig::new(MAX_TTL_SECONDS - 1);
    assert_eq!(config.ttl(), Duration::from_secs(MAX_TTL_SECONDS - 1));
}

#[test]
fn ttl_boundaries_are_inclusive() {
    let config = IdempotencyConfig::new(MIN_TTL_SECONDS);
    assert_eq!(config.ttl(), Duration::from_secs(MIN_TTL_SECONDS));

    let config = IdempotencyConfig::new(MAX_TTL_SECONDS);
    assert_eq!(config.ttl(), Duration::from_secs(MAX_TTL_SECONDS));
}

#[test]
fn ttl_seconds_accessor_matches_duration() {
    let config = IdempotencyConfig::new(900);
    assert_eq!(config.ttl_seconds(), 900);
    assert_eq!(config.ttl(), Duration::from_secs(config.ttl_seconds()));
}
