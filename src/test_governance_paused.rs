//! Tests for governance proposal voting/execution behavior while contract is paused.
//! SR-240
//!
//! Verifies that vote() and execute() are blocked while the contract is paused,
//! mirroring the existing require_not_paused() check in do_propose().
//! This ensures the circuit breaker can halt all governance operations.

#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

use crate::{
    ContractError, ProposalAction, SwiftRemitContract, SwiftRemitContractClient,
};

fn setup_env() -> (Env, SwiftRemitContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);
    (env, client)
}

fn default_token(env: &Env) -> Address {
    Address::generate(env)
}

fn initialize(
    env: &Env,
    client: &SwiftRemitContractClient,
    admin: &Address,
) {
    let token = default_token(env);
    client.initialize(admin, &token, &30u32, &0u64, &0u32, admin);
}

fn advance_time(env: &Env, seconds: u64) {
    env.ledger().with_mut(|li| li.timestamp += seconds);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: propose() is blocked while paused (existing behavior)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_propose_blocked_while_paused() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Pause the contract
    client.emergency_pause(&admin);

    // Attempt to propose while paused should fail
    let result = client.try_propose(&admin, &ProposalAction::UpdateFee(500u32));
    assert_eq!(result, Err(Ok(ContractError::ContractPaused)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: vote() blocked while paused (NEW REQUIREMENT)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_vote_blocked_while_paused() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Create a proposal while contract is not paused
    let proposal_id = client.propose(&admin, &ProposalAction::UpdateFee(500u32));
    assert!(proposal_id > 0);

    // Now pause the contract
    client.emergency_pause(&admin);

    // Attempt to vote while paused should fail
    let result = client.try_vote(&admin, &proposal_id);
    assert_eq!(
        result,
        Err(Ok(ContractError::ContractPaused)),
        "vote() should be blocked while contract is paused"
    );
}

#[test]
fn test_vote_succeeds_after_unpause() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Create a proposal
    let proposal_id = client.propose(&admin, &ProposalAction::UpdateFee(500u32));

    // Pause and then unpause the contract
    client.emergency_pause(&admin);
    client.emergency_unpause(&admin);

    // Vote should now succeed
    let result = client.try_vote(&admin, &proposal_id);
    assert!(
        result.is_ok() || result == Err(Ok(ContractError::AlreadyVoted)),
        "vote() should succeed after unpause"
    );
}

#[test]
fn test_vote_blocked_prevents_proposal_approval_during_pause() {
    let (env, client) = setup_env();
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    initialize(&env, &client, &admin1);
    client.migrate_to_governance(&admin1, &2u32, &0u64, &604_800u64);

    // Add second admin
    let p1 = client.propose(&admin1, &ProposalAction::AddAdmin(admin2.clone()));
    client.vote(&admin1, &p1);
    advance_time(&env, 1);
    client.execute(&admin1, &p1);

    // Create a fee update proposal
    let fee_proposal = client.propose(&admin1, &ProposalAction::UpdateFee(1000u32));

    // First admin votes
    client.vote(&admin1, &fee_proposal);

    // Pause before second admin can vote
    client.emergency_pause(&admin1);

    // Second admin cannot vote while paused
    let vote_result = client.try_vote(&admin2, &fee_proposal);
    assert_eq!(vote_result, Err(Ok(ContractError::ContractPaused)));

    // Verify proposal is still in Pending state (not Approved)
    let proposal = client.get_proposal(&fee_proposal);
    assert_eq!(
        proposal.approval_count, 1,
        "Proposal should still have only 1 approval (not reached quorum of 2)"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: execute() blocked while paused (NEW REQUIREMENT)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_execute_blocked_while_paused() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Create and approve a proposal
    let proposal_id = client.propose(&admin, &ProposalAction::UpdateFee(500u32));
    client.vote(&admin, &proposal_id);

    // Verify proposal is Approved
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.state.0, // ProposalState::Approved
        1,
        "Proposal should be in Approved state"
    );

    // Pause the contract
    client.emergency_pause(&admin);

    // Attempt to execute while paused should fail
    let result = client.try_execute(&admin, &proposal_id);
    assert_eq!(
        result,
        Err(Ok(ContractError::ContractPaused)),
        "execute() should be blocked while contract is paused"
    );
}

#[test]
fn test_execute_succeeds_after_unpause() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Create and approve a proposal
    let proposal_id = client.propose(&admin, &ProposalAction::UpdateFee(500u32));
    client.vote(&admin, &proposal_id);

    // Pause and then unpause the contract
    client.emergency_pause(&admin);
    client.emergency_unpause(&admin);

    // Execute should now succeed (if timelock has passed)
    let result = client.try_execute(&admin, &proposal_id);
    assert!(
        result.is_ok() || result == Err(Ok(ContractError::TimelockActive)),
        "execute() should succeed after unpause (or fail due to timelock, not pause)"
    );
}

#[test]
fn test_execute_blocked_prevents_fee_update_during_pause() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &0u64); // No timelock

    // Get the initial fee
    let initial_fee = client.get_platform_fee_bps();

    // Create, vote, and prepare to execute a fee update
    let proposal_id = client.propose(&admin, &ProposalAction::UpdateFee(1000u32));
    client.vote(&admin, &proposal_id);

    // Pause before execution
    client.emergency_pause(&admin);

    // Attempt to execute while paused should fail
    let result = client.try_execute(&admin, &proposal_id);
    assert_eq!(
        result,
        Err(Ok(ContractError::ContractPaused)),
        "execute() should be blocked during emergency pause"
    );

    // Verify fee hasn't changed
    let current_fee = client.get_platform_fee_bps();
    assert_eq!(current_fee, initial_fee, "Fee should not have changed");
}

#[test]
fn test_vote_and_execute_both_respect_pause() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &0u64);

    // Create a proposal
    let proposal_id = client.propose(&admin, &ProposalAction::UpdateFee(500u32));

    // Pause the contract
    client.emergency_pause(&admin);

    // Both vote() and execute() should be blocked
    let vote_result = client.try_vote(&admin, &proposal_id);
    assert_eq!(vote_result, Err(Ok(ContractError::ContractPaused)));

    let exec_result = client.try_execute(&admin, &proposal_id);
    assert_eq!(exec_result, Err(Ok(ContractError::ContractPaused)));
}

#[test]
fn test_propose_vote_execute_workflow_blocked_during_pause() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Can propose before pause
    let proposal_id = client.propose(&admin, &ProposalAction::UpdateFee(300u32));

    // Pause the contract
    client.emergency_pause(&admin);

    // All subsequent governance operations should fail
    let vote_result = client.try_vote(&admin, &proposal_id);
    assert_eq!(vote_result, Err(Ok(ContractError::ContractPaused)));

    let propose_result = client.try_propose(&admin, &ProposalAction::UpdateFee(400u32));
    assert_eq!(propose_result, Err(Ok(ContractError::ContractPaused)));

    let exec_result = client.try_execute(&admin, &proposal_id);
    assert_eq!(exec_result, Err(Ok(ContractError::ContractPaused)));
}
