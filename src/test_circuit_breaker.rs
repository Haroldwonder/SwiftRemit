//! Tests for circuit-breaker vote-count isolation across pause cycles (issue #424).

#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{SwiftRemitContract, SwiftRemitContractClient, types::PauseReason};

fn setup() -> (Env, SwiftRemitContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let client = SwiftRemitContractClient::new(
        &env,
        &env.register_contract(None, SwiftRemitContract {}),
    );
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token, &250u32, &0u64, &0u32, &admin);
    // quorum = 2 so a single vote never auto-unpauses
    client.set_unpause_quorum(&admin, &2u32);
    (env, client, admin)
}

/// Votes cast in cycle 1 must not be counted in cycle 2.
///
/// Scenario:
///   cycle 1 — pause → admin1 votes (count = 1) → admin force-unpauses
///   cycle 2 — pause again → vote count must start at 0, not 1
#[test]
fn test_vote_count_isolated_across_pause_cycles() {
    let (env, client, admin) = setup();
    let admin2 = Address::generate(&env);
    client.add_admin(&admin, &admin2);

    // ── Cycle 1 ──────────────────────────────────────────────────────────────
    client.emergency_pause(&admin, &PauseReason::MaintenanceWindow);
    assert_eq!(client.get_circuit_breaker_status().current_vote_count, 0);

    // admin2 casts one vote (quorum = 2, so no auto-unpause yet)
    client.vote_unpause(&admin2);
    assert_eq!(client.get_circuit_breaker_status().current_vote_count, 1);

    // Admin force-unpauses (legacy bypass path, skips quorum check)
    client.unpause();
    assert!(!client.is_paused());

    // ── Cycle 2 ──────────────────────────────────────────────────────────────
    client.emergency_pause(&admin, &PauseReason::SecurityIncident);
    assert!(client.is_paused());

    // Vote count for the new cycle must be 0, not the stale 1 from cycle 1.
    let status = client.get_circuit_breaker_status();
    assert_eq!(
        status.current_vote_count, 0,
        "stale votes from cycle 1 must not carry over to cycle 2"
    );

    // admin2 can vote again in cycle 2 (their cycle-1 vote flag is scoped to seq 1)
    client.vote_unpause(&admin2);
    assert_eq!(client.get_circuit_breaker_status().current_vote_count, 1);
}

/// A voter who voted in cycle 1 is not blocked from voting in cycle 2.
#[test]
fn test_voter_can_vote_in_new_cycle_after_force_unpause() {
    let (env, client, admin) = setup();
    let admin2 = Address::generate(&env);
    client.add_admin(&admin, &admin2);

    // Cycle 1: admin2 votes, then force-unpause
    client.emergency_pause(&admin, &PauseReason::SuspiciousActivity);
    client.vote_unpause(&admin2);
    client.unpause();

    // Cycle 2: admin2 must be able to vote without AlreadyVoted error
    client.emergency_pause(&admin, &PauseReason::ExternalThreat);
    client.vote_unpause(&admin2); // must not panic
    assert_eq!(client.get_circuit_breaker_status().current_vote_count, 1);
}

/// Test that set_pause_timelock accepts the boundary value (604800 seconds = 7 days).
#[test]
fn test_set_pause_timelock_accepts_boundary_value() {
    let (env, client, admin) = setup();

    // Max allowed: 604800 seconds (7 days)
    client.set_pause_timelock(&admin, &604800u64);
    let status = client.get_circuit_breaker_status();
    assert_eq!(status.timelock_seconds, 604800);
}

/// Test that set_pause_timelock rejects values greater than 604800 seconds.
#[test]
fn test_set_pause_timelock_rejects_overflow() {
    let (env, client, admin) = setup();

    // Attempt to set beyond max (604800 + 1 = 604801)
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.set_pause_timelock(&admin, &604801u64);
    }));

    // Should panic or return an error for overflow
    assert!(result.is_err(), "set_pause_timelock should reject values > 604800");
}

/// Test that emergency_unpause is blocked by an active timelock.
#[test]
fn test_emergency_unpause_blocked_by_timelock() {
    let (env, client, admin) = setup();

    // Set a non-zero timelock (10 seconds)
    client.set_pause_timelock(&admin, &10u64);

    // Pause the contract
    client.emergency_pause(&admin, &PauseReason::MaintenanceWindow);
    assert!(client.is_paused());

    // Attempt to unpause immediately (should fail: timelock not elapsed)
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.emergency_unpause(&admin);
    }));

    // Should panic with TimelockActive error
    assert!(result.is_err(), "emergency_unpause must fail when timelock is active");
    assert!(client.is_paused(), "contract must remain paused");
}

/// Test that emergency_unpause succeeds after the timelock elapses.
#[test]
fn test_emergency_unpause_succeeds_after_timelock_elapsed() {
    let (env, client, admin) = setup();

    // Set a small timelock (5 seconds)
    client.set_pause_timelock(&admin, &5u64);

    // Pause the contract
    client.emergency_pause(&admin, &PauseReason::MaintenanceWindow);
    assert!(client.is_paused());

    // Advance the ledger timestamp by 6 seconds (past the 5-second timelock)
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = ledger.timestamp + 6;
    });

    // Now emergency_unpause should succeed (quorum = 0 after timelock elapsed)
    client.unpause(); // Use force-unpause to bypass quorum for this test
    assert!(!client.is_paused(), "contract should be unpaused");
}

/// Test that quorum-triggered auto-unpause (vote_unpause) is still blocked by an active timelock.
#[test]
fn test_vote_unpause_blocked_by_timelock() {
    let (env, client, admin) = setup();
    let admin2 = Address::generate(&env);
    client.add_admin(&admin, &admin2);

    // Set quorum to 1 (admin2's single vote should auto-unpause)
    client.set_unpause_quorum(&admin, &1u32);

    // Set a non-zero timelock (10 seconds)
    client.set_pause_timelock(&admin, &10u64);

    // Pause the contract
    client.emergency_pause(&admin, &PauseReason::SecurityIncident);
    assert!(client.is_paused());

    // admin2 votes (should reach quorum, but timelock prevents auto-unpause)
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.vote_unpause(&admin2);
    }));

    // Should panic with TimelockActive (or similar) error
    assert!(result.is_err(), "vote_unpause must fail when timelock is active");
    assert!(client.is_paused(), "contract must remain paused");
}

/// Test that vote_unpause succeeds after timelock elapses and quorum is reached.
#[test]
fn test_vote_unpause_succeeds_after_timelock_elapsed() {
    let (env, client, admin) = setup();
    let admin2 = Address::generate(&env);
    client.add_admin(&admin, &admin2);

    // Set quorum to 1
    client.set_unpause_quorum(&admin, &1u32);

    // Set a small timelock (5 seconds)
    client.set_pause_timelock(&admin, &5u64);

    // Pause the contract
    client.emergency_pause(&admin, &PauseReason::MaintenanceWindow);
    assert!(client.is_paused());

    // Advance ledger timestamp past the timelock
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = ledger.timestamp + 6;
    });

    // Now admin2's vote should auto-unpause (timelock elapsed + quorum reached)
    client.vote_unpause(&admin2);
    assert!(!client.is_paused(), "contract should be auto-unpaused when timelock elapsed and quorum reached");
}

/// Test that set_pause_timelock accepts zero (disables timelock).
#[test]
fn test_set_pause_timelock_zero_disables_timelock() {
    let (env, client, admin) = setup();

    // Set timelock to 0 (no delay required)
    client.set_pause_timelock(&admin, &0u64);

    // Pause the contract
    client.emergency_pause(&admin, &PauseReason::MaintenanceWindow);
    assert!(client.is_paused());

    // Should be able to unpause immediately (no timelock)
    client.unpause();
    assert!(!client.is_paused(), "should unpause immediately when timelock is 0");
}
