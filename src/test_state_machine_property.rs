//! Property-based tests for RemittanceStatus state machine transitions (#845).
//!
//! Covers two key contracts:
//! - `validate_transition` returns `Err(ContractError::InvalidStateTransition)` for
//!   every invalid edge and `Ok(())` for every valid edge.
//! - `transition_status` correctly updates the `Remittance` struct status field
//!   after a valid transition.
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

// ─── Strategies ──────────────────────────────────────────────────────────────

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

/// All valid (non-idempotent) state machine edges.
fn arb_valid_transition() -> impl Strategy<Value = (RemittanceStatus, RemittanceStatus)> {
    prop_oneof![
        Just((RemittanceStatus::Pending, RemittanceStatus::Processing)),
        Just((RemittanceStatus::Pending, RemittanceStatus::Cancelled)),
        Just((RemittanceStatus::Pending, RemittanceStatus::Failed)),
        Just((RemittanceStatus::Processing, RemittanceStatus::Completed)),
        Just((RemittanceStatus::Processing, RemittanceStatus::Cancelled)),
        Just((RemittanceStatus::Processing, RemittanceStatus::Failed)),
        Just((RemittanceStatus::Failed, RemittanceStatus::Disputed)),
    ]
}

/// Transitions that must always be rejected (non-idempotent, non-edge pairs).
fn arb_invalid_transition() -> impl Strategy<Value = (RemittanceStatus, RemittanceStatus)> {
    prop_oneof![
        // Terminal states cannot leave to a different state
        Just((RemittanceStatus::Completed, RemittanceStatus::Pending)),
        Just((RemittanceStatus::Completed, RemittanceStatus::Processing)),
        Just((RemittanceStatus::Completed, RemittanceStatus::Cancelled)),
        Just((RemittanceStatus::Completed, RemittanceStatus::Failed)),
        Just((RemittanceStatus::Completed, RemittanceStatus::Disputed)),
        Just((RemittanceStatus::Cancelled, RemittanceStatus::Pending)),
        Just((RemittanceStatus::Cancelled, RemittanceStatus::Processing)),
        Just((RemittanceStatus::Cancelled, RemittanceStatus::Completed)),
        Just((RemittanceStatus::Cancelled, RemittanceStatus::Failed)),
        Just((RemittanceStatus::Cancelled, RemittanceStatus::Disputed)),
        // Skip-step transitions
        Just((RemittanceStatus::Pending, RemittanceStatus::Completed)),
        Just((RemittanceStatus::Pending, RemittanceStatus::Disputed)),
        Just((RemittanceStatus::Processing, RemittanceStatus::Pending)),
        // Backwards from Failed
        Just((RemittanceStatus::Failed, RemittanceStatus::Pending)),
        Just((RemittanceStatus::Failed, RemittanceStatus::Processing)),
        Just((RemittanceStatus::Failed, RemittanceStatus::Completed)),
        Just((RemittanceStatus::Failed, RemittanceStatus::Cancelled)),
        // Backwards from Disputed
        Just((RemittanceStatus::Disputed, RemittanceStatus::Pending)),
        Just((RemittanceStatus::Disputed, RemittanceStatus::Processing)),
        Just((RemittanceStatus::Disputed, RemittanceStatus::Failed)),
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
    }
}

// ─── Property Tests ───────────────────────────────────────────────────────────

proptest! {
    /// Every invalid transition must return exactly `ContractError::InvalidStateTransition`.
    #[test]
    fn prop_invalid_transitions_return_error_variant(
        (from, to) in arb_invalid_transition()
    ) {
        let result = validate_transition(&from, &to);
        prop_assert!(
            matches!(result, Err(ContractError::InvalidStateTransition)),
            "Expected InvalidStateTransition for {:?} -> {:?}, got {:?}",
            from, to, result
        );
    }

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
            rem.status, to,
            "Status not updated after {:?} -> {:?}", from, to
        );
    }

    /// Idempotent transitions (same state → same state) always succeed and leave status unchanged.
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
}
