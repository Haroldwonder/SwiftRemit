#![cfg(test)]

use crate::{SwiftRemitContract, SwiftRemitContractClient, RemittanceStatus};
use soroban_sdk::{testutils::Address as _, token, Address, Env};
use proptest::prelude::*;

fn create_token_contract<'a>(env: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    let contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    token::StellarAssetClient::new(env, &contract_id.address())
}

fn create_swiftremit_contract<'a>(env: &Env) -> SwiftRemitContractClient<'a> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

fn setup_contract(
    env: &Env,
) -> (
    SwiftRemitContractClient,
    token::StellarAssetClient,
    Address,
    Address,
    Address,
) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = create_token_contract(env, &token_admin);
    let agent = Address::generate(env);
    let sender = Address::generate(env);

    let contract = create_swiftremit_contract(env);

    env.mock_all_auths();
    contract.initialize(&admin, &token.address, &250, &0, &0, &admin);
    contract.register_agent(&agent);

    token.mint(&sender, &10000);

    (contract, token, admin, agent, sender)
}

#[test]
fn test_lifecycle_pending_to_completed() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup_contract(&env);

    env.mock_all_auths();
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None, &None, &None);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, RemittanceStatus::Pending);

    contract.confirm_payout(&remittance_id, &None);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, RemittanceStatus::Completed);
}

#[test]
fn test_lifecycle_pending_to_cancelled() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup_contract(&env);

    env.mock_all_auths();
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None, &None, &None);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, RemittanceStatus::Pending);

    contract.cancel_remittance(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, RemittanceStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_invalid_transition_cancel_after_completed() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup_contract(&env);

    env.mock_all_auths();
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None, &None, &None);

    contract.confirm_payout(&remittance_id, &None);
    contract.cancel_remittance(&remittance_id);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_invalid_transition_confirm_after_cancelled() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup_contract(&env);

    env.mock_all_auths();
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None, &None, &None);

    contract.cancel_remittance(&remittance_id);
    contract.confirm_payout(&remittance_id, &None);
}

#[test]
fn test_multiple_remittances_independent_lifecycles() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup_contract(&env);

    env.mock_all_auths();

    let remittance_id_1 = contract.create_remittance(&sender, &agent, &1000, &None, &None, &None);
    let remittance_id_2 = contract.create_remittance(&sender, &agent, &2000, &None, &None, &None);

    contract.confirm_payout(&remittance_id_1, &None);
    contract.cancel_remittance(&remittance_id_2);

    let remittance_1 = contract.get_remittance(&remittance_id_1);
    let remittance_2 = contract.get_remittance(&remittance_id_2);

    assert_eq!(remittance_1.status, RemittanceStatus::Completed);
    assert_eq!(remittance_2.status, RemittanceStatus::Cancelled);
}

// ═══════════════════════════════════════════════════════════════════════════
// Property-Based Tests for State Machine Invariants
// ═══════════════════════════════════════════════════════════════════════════

/// Strategy to generate arbitrary RemittanceStatus values
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

/// Strategy to generate valid transition pairs (from, to)
fn arb_valid_transition() -> impl Strategy<Value = (RemittanceStatus, RemittanceStatus)> {
    prop_oneof![
        // From Pending
        Just((RemittanceStatus::Pending, RemittanceStatus::Processing)),
        Just((RemittanceStatus::Pending, RemittanceStatus::Cancelled)),
        Just((RemittanceStatus::Pending, RemittanceStatus::Failed)),
        // From Processing
        Just((RemittanceStatus::Processing, RemittanceStatus::Completed)),
        Just((RemittanceStatus::Processing, RemittanceStatus::Cancelled)),
        Just((RemittanceStatus::Processing, RemittanceStatus::Failed)),
        // From Failed
        Just((RemittanceStatus::Failed, RemittanceStatus::Disputed)),
        // Idempotent transitions (same state)
        Just((RemittanceStatus::Pending, RemittanceStatus::Pending)),
        Just((RemittanceStatus::Processing, RemittanceStatus::Processing)),
        Just((RemittanceStatus::Completed, RemittanceStatus::Completed)),
        Just((RemittanceStatus::Cancelled, RemittanceStatus::Cancelled)),
        Just((RemittanceStatus::Failed, RemittanceStatus::Failed)),
        Just((RemittanceStatus::Disputed, RemittanceStatus::Disputed)),
    ]
}

/// Strategy to generate invalid transition pairs
fn arb_invalid_transition() -> impl Strategy<Value = (RemittanceStatus, RemittanceStatus)> {
    prop_oneof![
        // Terminal states cannot transition
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
        // Invalid forward transitions
        Just((RemittanceStatus::Pending, RemittanceStatus::Completed)),
        Just((RemittanceStatus::Pending, RemittanceStatus::Disputed)),
        Just((RemittanceStatus::Processing, RemittanceStatus::Pending)),
        Just((RemittanceStatus::Processing, RemittanceStatus::Processing)),
        Just((RemittanceStatus::Failed, RemittanceStatus::Pending)),
        Just((RemittanceStatus::Failed, RemittanceStatus::Processing)),
        Just((RemittanceStatus::Failed, RemittanceStatus::Completed)),
        Just((RemittanceStatus::Failed, RemittanceStatus::Cancelled)),
        Just((RemittanceStatus::Disputed, RemittanceStatus::Pending)),
        Just((RemittanceStatus::Disputed, RemittanceStatus::Processing)),
        Just((RemittanceStatus::Disputed, RemittanceStatus::Failed)),
    ]
}

proptest! {
    /// Invariant: Terminal states (Completed, Cancelled) cannot transition to any other state
    #[test]
    fn prop_terminal_states_are_immutable(status in arb_status()) {
        let is_terminal = matches!(status, RemittanceStatus::Completed | RemittanceStatus::Cancelled);
        
        if is_terminal {
            // Terminal states should not transition to any different state
            for target in [
                RemittanceStatus::Pending,
                RemittanceStatus::Processing,
                RemittanceStatus::Completed,
                RemittanceStatus::Cancelled,
                RemittanceStatus::Failed,
                RemittanceStatus::Disputed,
            ] {
                if status != target {
                    prop_assert!(!status.can_transition_to(&target),
                        "Terminal state {:?} should not transition to {:?}", status, target);
                }
            }
        }
    }

    /// Invariant: All valid transitions are explicitly allowed by can_transition_to
    #[test]
    fn prop_valid_transitions_allowed((from, to) in arb_valid_transition()) {
        prop_assert!(from.can_transition_to(&to),
            "Valid transition {:?} -> {:?} should be allowed", from, to);
    }

    /// Invariant: All invalid transitions are explicitly rejected by can_transition_to
    #[test]
    fn prop_invalid_transitions_rejected((from, to) in arb_invalid_transition()) {
        prop_assert!(!from.can_transition_to(&to),
            "Invalid transition {:?} -> {:?} should be rejected", from, to);
    }

    /// Invariant: Idempotent transitions (same state) are always allowed
    #[test]
    fn prop_idempotent_transitions_allowed(status in arb_status()) {
        prop_assert!(status.can_transition_to(&status),
            "Idempotent transition {:?} -> {:?} should be allowed", status, status);
    }

    /// Invariant: If A can transition to B, and B is terminal, then B cannot transition further
    #[test]
    fn prop_terminal_states_block_further_transitions(
        (from, to) in arb_valid_transition()
    ) {
        if to == RemittanceStatus::Completed || to == RemittanceStatus::Cancelled {
            // to is terminal, so it should not transition to any different state
            for target in [
                RemittanceStatus::Pending,
                RemittanceStatus::Processing,
                RemittanceStatus::Completed,
                RemittanceStatus::Cancelled,
                RemittanceStatus::Failed,
                RemittanceStatus::Disputed,
            ] {
                if to != target {
                    prop_assert!(!to.can_transition_to(&target),
                        "Terminal state {:?} reached from {:?} should not transition to {:?}",
                        to, from, target);
                }
            }
        }
    }

    /// Invariant: Transition graph is acyclic (no cycles except self-loops)
    #[test]
    fn prop_no_cycles_in_state_graph(
        (from, to) in arb_valid_transition()
    ) {
        if from != to {
            // If we can go from A to B, we should not be able to go back from B to A
            // (except through a longer path that eventually reaches a terminal state)
            let reverse_allowed = to.can_transition_to(&from);
            
            // Only allow reverse if both are non-terminal and form a valid cycle
            // In our state machine, there are no valid cycles
            if from != to {
                prop_assert!(!reverse_allowed,
                    "State machine should be acyclic: {:?} -> {:?} should not allow reverse",
                    from, to);
            }
        }
    }

    /// Invariant: Disputed state can only be reached from Failed state
    #[test]
    fn prop_disputed_only_from_failed(status in arb_status()) {
        if status == RemittanceStatus::Disputed {
            // Disputed should only be reachable from Failed
            prop_assert!(RemittanceStatus::Failed.can_transition_to(&RemittanceStatus::Disputed),
                "Failed should transition to Disputed");
        }
        
        // No other state should transition to Disputed
        if status != RemittanceStatus::Failed {
            prop_assert!(!status.can_transition_to(&RemittanceStatus::Disputed),
                "Only Failed should transition to Disputed, not {:?}", status);
        }
    }

    /// Invariant: Pending is the only initial state (no state transitions to Pending)
    #[test]
    fn prop_pending_is_initial_only(status in arb_status()) {
        if status != RemittanceStatus::Pending {
            prop_assert!(!status.can_transition_to(&RemittanceStatus::Pending),
                "No state should transition to Pending (initial state), but {:?} can", status);
        }
    }

    /// Invariant: All non-terminal states have at least one valid outgoing transition
    #[test]
    fn prop_non_terminal_states_have_exits(status in arb_status()) {
        let is_terminal = matches!(status, RemittanceStatus::Completed | RemittanceStatus::Cancelled);
        
        if !is_terminal {
            let has_exit = [
                RemittanceStatus::Pending,
                RemittanceStatus::Processing,
                RemittanceStatus::Completed,
                RemittanceStatus::Cancelled,
                RemittanceStatus::Failed,
                RemittanceStatus::Disputed,
            ].iter().any(|target| status.can_transition_to(target) && *target != status);
            
            prop_assert!(has_exit,
                "Non-terminal state {:?} should have at least one outgoing transition", status);
        }
    }

    /// Invariant: Transition validation is consistent (deterministic)
    #[test]
    fn prop_transition_validation_is_deterministic(
        (from, to) in arb_valid_transition()
    ) {
        let result1 = from.can_transition_to(&to);
        let result2 = from.can_transition_to(&to);
        let result3 = from.can_transition_to(&to);
        
        prop_assert_eq!(result1, result2, "Transition validation should be deterministic");
        prop_assert_eq!(result2, result3, "Transition validation should be deterministic");
    }
}

#[test]
fn test_state_machine_graph_coverage() {
    // Verify all expected transitions exist
    let valid_transitions = vec![
        (RemittanceStatus::Pending, RemittanceStatus::Processing),
        (RemittanceStatus::Pending, RemittanceStatus::Cancelled),
        (RemittanceStatus::Pending, RemittanceStatus::Failed),
        (RemittanceStatus::Processing, RemittanceStatus::Completed),
        (RemittanceStatus::Processing, RemittanceStatus::Cancelled),
        (RemittanceStatus::Processing, RemittanceStatus::Failed),
        (RemittanceStatus::Failed, RemittanceStatus::Disputed),
    ];

    for (from, to) in valid_transitions {
        assert!(
            from.can_transition_to(&to),
            "Expected valid transition {:?} -> {:?}",
            from,
            to
        );
    }
}

#[test]
fn test_terminal_states_comprehensive() {
    let terminal_states = vec![RemittanceStatus::Completed, RemittanceStatus::Cancelled];
    let all_states = vec![
        RemittanceStatus::Pending,
        RemittanceStatus::Processing,
        RemittanceStatus::Completed,
        RemittanceStatus::Cancelled,
        RemittanceStatus::Failed,
        RemittanceStatus::Disputed,
    ];

    for terminal in &terminal_states {
        for target in &all_states {
            if terminal != target {
                assert!(
                    !terminal.can_transition_to(target),
                    "Terminal state {:?} should not transition to {:?}",
                    terminal,
                    target
                );
            }
        }
    }
}
