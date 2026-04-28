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
    client.initialize(&admin, &token, &250u32, &0u32, &0u32, &admin);
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
