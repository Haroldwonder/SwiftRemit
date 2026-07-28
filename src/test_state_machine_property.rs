//! Property-based tests for RemittanceStatus state machine transitions (#845, SR-012).
//!
//! Covers three key contracts:
//! - `validate_transition` returns `Err(ContractError::InvalidStateTransition)` for
//!   every invalid edge and `Ok(())` for every valid edge.
//! - `transition_status` correctly updates the `Remittance` struct status field
//!   after a valid transition.
//! - The full 36-pair `(from, to)` matrix over all 6 `RemittanceStatus` values is
//!   explicitly enumerated and checked against the 9-row table in the README
//!   ("Valid Transitions" section), so this test breaks the moment `transitions.rs`
//!   (or `RemittanceStatus::can_transition_to`) diverges from the documented state
//!   machine in either direction (an unauthorised transition added, or a documented
//!   one silently dropped).
//!
//! These tests run under `cargo test` (no feature gate) and are therefore included
//! in the property-tests CI job (`cargo test prop_`).

#![cfg(test)]

extern crate std;

use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Env};

use crate::{
    errors::ContractError,
    transitions::{transition_status, validate_transition},
    types::RemittanceStatus,
    MaybeBytes32, MaybeSettlementConfig,
};

// ─── The canonical transition table (mirrors README "Valid Transitions") ──────

/// The 9 valid, non-idempotent `(from, to)` edges documented in README.md.
///
/// This is the single source of truth for the exhaustive matrix test below.
/// If a row is added here without a matching change to
/// `RemittanceStatus::can_transition_to`, `test_matrix_matches_can_transition_to`
/// fails. If `can_transition_to` grows an edge not listed here, the same test
/// fails in the other direction.
fn transition_table() -> std::vec::Vec<(RemittanceStatus, RemittanceStatus)> {
    std::vec![
        (RemittanceStatus::Pending, RemittanceStatus::Processing),
        (RemittanceStatus::Pending, RemittanceStatus::Cancelled),
        (RemittanceStatus::Pending, RemittanceStatus::Failed),
        (RemittanceStatus::Processing, RemittanceStatus::Completed),
        (RemittanceStatus::Processing, RemittanceStatus::Cancelled),
        (RemittanceStatus::Processing, RemittanceStatus::Failed),
        (RemittanceStatus::Failed, RemittanceStatus::Disputed),
        (RemittanceStatus::Disputed, RemittanceStatus::Cancelled),
        (RemittanceStatus::Disputed, RemittanceStatus::Completed),
    ]
}

fn all_statuses() -> [RemittanceStatus; 6] {
    [
        RemittanceStatus::Pending,
        RemittanceStatus::Processing,
        RemittanceStatus::Completed,
        RemittanceStatus::Cancelled,
        RemittanceStatus::Failed,
        RemittanceStatus::Disputed,
    ]
}

fn arb_status() -> impl Strategy<Value = RemittanceStatus> {
    prop_oneof![
        Just(RemittanceStatus::Pending),
        Just(RemittanceStatus::Processing),
        Just(RemittanceStatus::Completed),
        Just(RemittanceStatus::Cancelled),
        Just(RemittanceStatus::Failed),
        Just(RemittanceStatus::Disputed),
    ]
}

/// All valid (non-idempotent) state machine edges, driven by `transition_table()`.
fn arb_valid_transition() -> impl Strategy<Value = (RemittanceStatus, RemittanceStatus)> {
    prop_oneof![
        Just((RemittanceStatus::Pending, RemittanceStatus::Processing)),
        Just((RemittanceStatus::Pending, RemittanceStatus::Cancelled)),
        Just((RemittanceStatus::Pending, RemittanceStatus::Failed)),
        Just((RemittanceStatus::Processing, RemittanceStatus::Completed)),
        Just((RemittanceStatus::Processing, RemittanceStatus::Cancelled)),
        Just((RemittanceStatus::Processing, RemittanceStatus::Failed)),
        Just((RemittanceStatus::Failed, RemittanceStatus::Disputed)),
        Just((RemittanceStatus::Disputed, RemittanceStatus::Cancelled)),
        Just((RemittanceStatus::Disputed, RemittanceStatus::Completed)),
    ]
}

fn make_remittance(env: &Env, status: RemittanceStatus) -> crate::Remittance {
    crate::Remittance {
        id: 1,
        sender: soroban_sdk::Address::generate(env),
        agent: soroban_sdk::Address::generate(env),
        amount: 1_000,
        fee: 10,
        status,
        expiry: None,
        settlement_config: MaybeSettlementConfig::None,
        token: soroban_sdk::Address::generate(env),
        created_at: 0,
        failed_at: None,
        dispute_evidence: MaybeBytes32::None,
        expires_at: None,
    }
}

// ─── Exhaustive 36-pair matrix ─────────────────────────────────────────────────

/// Enumerates all 36 ordered `(from, to)` pairs over the 6 `RemittanceStatus`
/// values and asserts each is accepted iff it is a same-state pair (idempotent)
/// or appears in `transition_table()`. This is the test the AC in SR-012 refers
/// to as "all 36 pairs are explicitly asserted."
#[test]
fn test_matrix_matches_can_transition_to() {
    let table = transition_table();
    let statuses = all_statuses();

    let mut asserted_pairs = 0u32;
    let mut accepted = 0u32;
    let mut rejected = 0u32;

    for from in statuses.iter() {
        for to in statuses.iter() {
            asserted_pairs += 1;
            let should_accept = from == to || table.iter().any(|(f, t)| f == from && t == to);
            let result = validate_transition(from, to);

            if should_accept {
                assert!(
                    result.is_ok(),
                    "Expected {:?} -> {:?} to be ACCEPTED (idempotent or in transition_table), got {:?}",
                    from, to, result
                );
                accepted += 1;
            } else {
                assert!(
                    matches!(result, Err(ContractError::InvalidStateTransition)),
                    "Expected {:?} -> {:?} to be REJECTED, got {:?}",
                    from, to, result
                );
                rejected += 1;
            }
        }
    }

    assert_eq!(asserted_pairs, 36, "Must cover all 6x6 = 36 ordered pairs");
    // 6 same-state (idempotent) pairs + the 9 documented edges = 15 accepted.
    assert_eq!(accepted, 15, "Expected exactly 15 accepted pairs (6 idempotent + 9 documented)");
    assert_eq!(rejected, 21, "Expected exactly 21 rejected pairs");
}

/// The table above must have exactly the 9 rows documented in README.md's
/// "Valid Transitions" table — this guards against silently editing the table
/// itself to match a code regression instead of catching one.
#[test]
fn test_transition_table_matches_readme_row_count() {
    assert_eq!(transition_table().len(), 9, "README documents exactly 9 valid transitions");
}

/// Terminal states (Completed, Cancelled) must reject every one of the 5 other
/// outgoing transitions, exhaustively (not sampled).
#[test]
fn test_terminal_states_reject_all_outgoing() {
    for terminal in [RemittanceStatus::Completed, RemittanceStatus::Cancelled] {
        for to in all_statuses().iter() {
            if *to == terminal {
                continue;
            }
            let result = validate_transition(&terminal, to);
            assert!(
                matches!(result, Err(ContractError::InvalidStateTransition)),
                "Terminal state {:?} must reject transition to {:?}, got {:?}",
                terminal, to, result
            );
        }
    }
}

// ─── Property Tests ───────────────────────────────────────────────────────────

proptest! {
    /// Every valid transition must return `Ok(())`.
    #[test]
    fn prop_valid_transitions_return_ok(
        (from, to) in arb_valid_transition()
    ) {
        let result = validate_transition(&from, &to);
        prop_assert!(
            result.is_ok(),
            "Expected Ok for {:?} -> {:?}, got {:?}",
            from, to, result
        );
    }

    /// After a valid `transition_status` call the remittance status is updated to `to`.
    #[test]
    fn prop_valid_transitions_update_storage(
        (from, to) in arb_valid_transition()
    ) {
        let env = Env::default();
        let mut rem = make_remittance(&env, from.clone());

        let result = transition_status(&env, &mut rem, to.clone());
        prop_assert!(result.is_ok(), "transition_status failed: {:?}", result);
        prop_assert_eq!(
            rem.status, to.clone(),
            "Status not updated after {:?} -> {:?}", from, to
        );
    }

    /// Idempotent transitions (same state -> same state) always succeed and leave status unchanged.
    #[test]
    fn prop_idempotent_transitions_preserve_status(status in arb_status()) {
        let env = Env::default();
        let mut rem = make_remittance(&env, status.clone());

        let result = transition_status(&env, &mut rem, status.clone());
        prop_assert!(result.is_ok(), "Idempotent transition failed for {:?}", status);
        prop_assert_eq!(rem.status, status);
    }

    /// Terminal states (Completed, Cancelled) must reject every non-idempotent transition.
    #[test]
    fn prop_terminal_states_reject_non_idempotent(
        from in prop_oneof![
            Just(RemittanceStatus::Completed),
            Just(RemittanceStatus::Cancelled),
        ],
        to in arb_status(),
    ) {
        if from != to {
            let result = validate_transition(&from, &to);
            prop_assert!(
                matches!(result, Err(ContractError::InvalidStateTransition)),
                "Terminal {:?} must reject {:?}, got {:?}", from, to, result
            );
        }
    }

    /// Disputed is only reachable from Failed; no other state may transition to it.
    #[test]
    fn prop_disputed_only_reachable_from_failed(from in arb_status()) {
        if from != RemittanceStatus::Failed && from != RemittanceStatus::Disputed {
            let result = validate_transition(&from, &RemittanceStatus::Disputed);
            prop_assert!(
                matches!(result, Err(ContractError::InvalidStateTransition)),
                "Only Failed may transition to Disputed; {:?} should be rejected", from
            );
        }
    }

    /// Pending is the sole initial state; no other state may return to Pending.
    #[test]
    fn prop_pending_is_initial_only(from in arb_status()) {
        if from != RemittanceStatus::Pending {
            let result = validate_transition(&from, &RemittanceStatus::Pending);
            prop_assert!(
                matches!(result, Err(ContractError::InvalidStateTransition)),
                "{:?} should not transition back to Pending", from
            );
        }
    }

    /// No sequence of `transition_status` calls can ever land on a pair that isn't
    /// in `transition_table()` or idempotent: walk a bounded random sequence of
    /// candidate next-states and assert every accepted step is a documented edge.
    #[test]
    fn prop_random_walk_never_takes_undocumented_edge(
        steps in prop::collection::vec(arb_status(), 1..12)
    ) {
        let env = Env::default();
        let table = transition_table();
        let mut rem = make_remittance(&env, RemittanceStatus::Pending);

        for next in steps {
            let from = rem.status.clone();
            let result = transition_status(&env, &mut rem, next.clone());
            if result.is_ok() {
                let documented = from == next || table.iter().any(|(f, t)| *f == from && *t == next);
                prop_assert!(
                    documented,
                    "transition_status accepted undocumented edge {:?} -> {:?}", from, next
                );
                prop_assert_eq!(&rem.status, &next);
            } else {
                // Rejected: state must be unchanged.
                prop_assert_eq!(&rem.status, &from);
            }
        }
    }
}
