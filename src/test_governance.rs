//! Unit tests for the multi-admin / DAO governance module.
//!
//! Covers the full proposal lifecycle for each action type, error conditions,
//! event emission, backward compatibility, and single-admin mode.

#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

use crate::{
    ContractError, Proposal, ProposalAction, ProposalState, SwiftRemitContract,
    SwiftRemitContractClient,
};

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

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
    client.initialize(admin, &token, &30u32, &0u32, admin, &0u32);
}

fn advance_time(env: &Env, seconds: u64) {
    let info = env.ledger().get();
    env.ledger().set(LedgerInfo {
        timestamp: info.timestamp + seconds,
        ..info
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.1 — migrate_to_governance happy path and double-call rejection
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_migrate_to_governance_happy_path() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);

    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    assert_eq!(client.get_quorum(), 1u32);
    assert_eq!(client.get_timelock_seconds(), 0u64);
}

#[test]
fn test_migrate_to_governance_double_call_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);

    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let result = client.try_migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);
    assert_eq!(result, Err(Ok(ContractError::GovernanceAlreadyInitialized)));
}

#[test]
fn test_migrate_to_governance_non_admin_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let other = Address::generate(&env);
    initialize(&env, &client, &admin);

    let result = client.try_migrate_to_governance(&other, &1u32, &0u64, &604_800u64);
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.2 — UpdateFee proposal lifecycle
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_update_fee_proposal_lifecycle() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(500u32));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);

    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Executed);
}

#[test]
fn test_update_fee_invalid_bps_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let result = client.try_propose(&admin, &ProposalAction::UpdateFee(10_001u32));
    assert_eq!(result, Err(Ok(ContractError::InvalidFeeBps)));
}

#[test]
fn test_duplicate_fee_proposal_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    let result = client.try_propose(&admin, &ProposalAction::UpdateFee(200u32));
    assert_eq!(result, Err(Ok(ContractError::ProposalAlreadyPending)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.3 — RegisterAgent proposal lifecycle
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_register_agent_proposal_lifecycle() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::RegisterAgent(agent.clone()));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);

    assert!(client.is_agent_registered(&agent));
}

#[test]
fn test_register_already_registered_agent_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Register via governance first
    let pid = client.propose(&admin, &ProposalAction::RegisterAgent(agent.clone()));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);

    // Second proposal for same agent should fail
    let result = client.try_propose(&admin, &ProposalAction::RegisterAgent(agent.clone()));
    assert_eq!(result, Err(Ok(ContractError::AgentAlreadyRegistered)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.4 — RemoveAgent proposal lifecycle
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_remove_agent_proposal_lifecycle() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Register then remove
    let pid1 = client.propose(&admin, &ProposalAction::RegisterAgent(agent.clone()));
    client.vote(&admin, &pid1);
    client.execute(&admin, &pid1);

    let pid2 = client.propose(&admin, &ProposalAction::RemoveAgent(agent.clone()));
    client.vote(&admin, &pid2);
    client.execute(&admin, &pid2);

    assert!(!client.is_agent_registered(&agent));
}

#[test]
fn test_remove_unregistered_agent_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let result = client.try_propose(&admin, &ProposalAction::RemoveAgent(agent.clone()));
    assert_eq!(result, Err(Ok(ContractError::AgentNotRegistered)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.5 — AddAdmin proposal lifecycle
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_add_admin_proposal_lifecycle() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::AddAdmin(new_admin.clone()));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);

    assert!(client.is_admin(&new_admin));
    assert_eq!(client.get_admin_count(), 2u32);

    let admins = client.get_admins();
    assert!(admins.contains(&new_admin));
}

#[test]
fn test_add_existing_admin_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let result = client.try_propose(&admin, &ProposalAction::AddAdmin(admin.clone()));
    assert_eq!(result, Err(Ok(ContractError::AlreadyAdmin)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.6 — RemoveAdmin proposal lifecycle
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_remove_admin_proposal_lifecycle() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Add a second admin first
    let pid1 = client.propose(&admin, &ProposalAction::AddAdmin(admin2.clone()));
    client.vote(&admin, &pid1);
    client.execute(&admin, &pid1);

    // Now remove admin2 — quorum is 1, admin count is 2, so removal is valid
    let pid2 = client.propose(&admin, &ProposalAction::RemoveAdmin(admin2.clone()));
    client.vote(&admin, &pid2);
    client.execute(&admin, &pid2);

    assert!(!client.is_admin(&admin2));
    assert_eq!(client.get_admin_count(), 1u32);
}

#[test]
fn test_remove_last_admin_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let result = client.try_propose(&admin, &ProposalAction::RemoveAdmin(admin.clone()));
    assert_eq!(result, Err(Ok(ContractError::InsufficientAdmins)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.7 — UpdateQuorum and UpdateTimelock proposals
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_update_quorum_proposal() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Add second admin so quorum of 2 is valid
    let pid1 = client.propose(&admin, &ProposalAction::AddAdmin(admin2.clone()));
    client.vote(&admin, &pid1);
    client.execute(&admin, &pid1);

    let pid2 = client.propose(&admin, &ProposalAction::UpdateQuorum(2u32));
    client.vote(&admin, &pid2);
    client.execute(&admin, &pid2);

    assert_eq!(client.get_quorum(), 2u32);
}

#[test]
fn test_update_timelock_proposal() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateTimelock(3600u64));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);

    assert_eq!(client.get_timelock_seconds(), 3600u64);
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.8 — Timelock enforcement
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_execute_before_timelock_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    // Set a 1-hour timelock
    client.migrate_to_governance(&admin, &1u32, &3600u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    client.vote(&admin, &pid);

    // Try to execute immediately — should fail
    let result = client.try_execute(&admin, &pid);
    assert_eq!(result, Err(Ok(ContractError::TimelockNotElapsed)));
}

#[test]
fn test_execute_after_timelock_succeeds() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &3600u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    client.vote(&admin, &pid);

    // Advance time past the timelock
    advance_time(&env, 3601);

    client.execute(&admin, &pid);
    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Executed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.9 — Proposal expiry
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_expire_proposal_after_ttl() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    // Short TTL of 100 seconds
    client.migrate_to_governance(&admin, &1u32, &0u64, &100u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));

    // Advance past TTL
    advance_time(&env, 101);

    client.expire_proposal(&pid);
    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Expired);
}

#[test]
fn test_expire_proposal_before_ttl_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));

    // Try to expire immediately — should fail
    let result = client.try_expire_proposal(&pid);
    assert_eq!(result, Err(Ok(ContractError::InvalidProposalState)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.10 — Single-admin mode: immediate execution
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_single_admin_immediate_execution() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    // quorum=1, timelock=0 → single-admin mode
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(250u32));
    // One vote reaches quorum
    client.vote(&admin, &pid);
    // Execute immediately (no timelock)
    client.execute(&admin, &pid);

    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Executed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.11 — Error conditions
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_non_admin_propose_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let other = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let result = client.try_propose(&other, &ProposalAction::UpdateFee(100u32));
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

#[test]
fn test_non_admin_vote_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let other = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    let result = client.try_vote(&other, &pid);
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

#[test]
fn test_double_vote_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Add second admin so quorum can be 2
    let pid0 = client.propose(&admin, &ProposalAction::AddAdmin(admin2.clone()));
    client.vote(&admin, &pid0);
    client.execute(&admin, &pid0);

    // Set quorum to 2
    let pid1 = client.propose(&admin, &ProposalAction::UpdateQuorum(2u32));
    client.vote(&admin, &pid1);
    client.vote(&admin2, &pid1);
    client.execute(&admin, &pid1);

    let pid2 = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    client.vote(&admin, &pid2);
    let result = client.try_vote(&admin, &pid2);
    assert_eq!(result, Err(Ok(ContractError::AlreadyVoted)));
}

#[test]
fn test_execute_non_approved_proposal_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    // Don't vote — proposal stays Pending
    let result = client.try_execute(&admin, &pid);
    assert_eq!(result, Err(Ok(ContractError::InvalidProposalState)));
}

#[test]
fn test_execute_already_executed_proposal_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);

    let result = client.try_execute(&admin, &pid);
    assert_eq!(result, Err(Ok(ContractError::InvalidProposalState)));
}

#[test]
fn test_invalid_quorum_at_migration_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);

    // quorum=0 is invalid
    let result = client.try_migrate_to_governance(&admin, &0u32, &0u64, &604_800u64);
    assert_eq!(result, Err(Ok(ContractError::InvalidQuorum)));

    // quorum > admin_count (1) is invalid
    let result2 = client.try_migrate_to_governance(&admin, &2u32, &0u64, &604_800u64);
    assert_eq!(result2, Err(Ok(ContractError::InvalidQuorum)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.13 — Backward compatibility: get_admin returns legacy admin
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_get_admin_backward_compat_after_governance_init() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Legacy get_admin should still return the original admin
    assert_eq!(client.get_admin().unwrap(), admin);
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #416 — cleanup_expired_proposals
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_cleanup_expired_proposal_removes_from_storage() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &100u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));

    // Expire the proposal
    advance_time(&env, 101);
    client.expire_proposal(&pid);

    // Cleanup
    let ids = soroban_sdk::vec![&env, pid];
    client.cleanup_expired_proposals(&admin, &ids);

    // get_proposal should now return ProposalNotFound
    let result = client.try_get_proposal(&pid);
    assert_eq!(result, Err(Ok(ContractError::ProposalNotFound)));
}

#[test]
fn test_cleanup_executed_proposal_removes_from_storage() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);

    let ids = soroban_sdk::vec![&env, pid];
    client.cleanup_expired_proposals(&admin, &ids);

    let result = client.try_get_proposal(&pid);
    assert_eq!(result, Err(Ok(ContractError::ProposalNotFound)));
}

#[test]
fn test_cleanup_pending_proposal_is_skipped() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));

    // Cleanup while still Pending — should be a no-op
    let ids = soroban_sdk::vec![&env, pid];
    client.cleanup_expired_proposals(&admin, &ids);

    // Proposal should still exist
    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Pending);
}

#[test]
fn test_cleanup_non_admin_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let other = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);

    let ids = soroban_sdk::vec![&env, pid];
    let result = client.try_cleanup_expired_proposals(&other, &ids);
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #417 — query_governance_config
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_query_governance_config_returns_correct_values() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &3600u64, &86_400u64);

    let config = client.query_governance_config();
    assert_eq!(config.quorum, 1u32);
    assert_eq!(config.timelock_seconds, 3600u64);
    assert_eq!(config.proposal_ttl_seconds, 86_400u64);
}

#[test]
fn test_query_governance_config_reflects_updates() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Update timelock via proposal
    let pid = client.propose(&admin, &ProposalAction::UpdateTimelock(7200u64));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);

    let config = client.query_governance_config();
    assert_eq!(config.timelock_seconds, 7200u64);
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #540 — Additional governance tests
// ─────────────────────────────────────────────────────────────────────────────

// ── Timelock enforcement ──────────────────────────────────────────────────────

#[test]
fn test_execute_at_exact_timelock_boundary_succeeds() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &3600u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    client.vote(&admin, &pid);

    // Advance to exactly the timelock boundary (approved_at + 3600)
    advance_time(&env, 3600);
    client.execute(&admin, &pid);

    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Executed);
}

#[test]
fn test_execute_one_second_before_timelock_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &3600u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    client.vote(&admin, &pid);

    // One second short of the timelock
    advance_time(&env, 3599);
    let result = client.try_execute(&admin, &pid);
    assert_eq!(result, Err(Ok(ContractError::TimelockNotElapsed)));
}

// ── Proposal expiry ───────────────────────────────────────────────────────────

#[test]
fn test_vote_on_expired_proposal_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    initialize(&env, &client, &admin);
    // quorum=2 so the proposal stays Pending after one vote
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Add second admin and raise quorum to 2
    let pid0 = client.propose(&admin, &ProposalAction::AddAdmin(admin2.clone()));
    client.vote(&admin, &pid0);
    client.execute(&admin, &pid0);

    let pid1 = client.propose(&admin, &ProposalAction::UpdateQuorum(2u32));
    client.vote(&admin, &pid1);
    client.vote(&admin2, &pid1);
    client.execute(&admin, &pid1);

    // Short TTL
    let pid2 = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    // Expire the proposal by advancing past the TTL
    advance_time(&env, 604_801);
    client.expire_proposal(&pid2);

    // Voting on an expired proposal should fail
    let result = client.try_vote(&admin2, &pid2);
    assert_eq!(result, Err(Ok(ContractError::InvalidProposalState)));
}

#[test]
fn test_execute_expired_proposal_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &100u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    client.vote(&admin, &pid);

    // Advance past TTL and expire
    advance_time(&env, 101);
    client.expire_proposal(&pid);

    // Execute on expired proposal should fail
    let result = client.try_execute(&admin, &pid);
    assert_eq!(result, Err(Ok(ContractError::InvalidProposalState)));
}

// ── Quorum edge cases ─────────────────────────────────────────────────────────

#[test]
fn test_quorum_exactly_at_threshold_executes() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Add two more admins
    let pid1 = client.propose(&admin, &ProposalAction::AddAdmin(admin2.clone()));
    client.vote(&admin, &pid1);
    client.execute(&admin, &pid1);

    let pid2 = client.propose(&admin, &ProposalAction::AddAdmin(admin3.clone()));
    client.vote(&admin, &pid2);
    client.execute(&admin, &pid2);

    // Set quorum to 2 (threshold)
    let pid3 = client.propose(&admin, &ProposalAction::UpdateQuorum(2u32));
    client.vote(&admin, &pid3);
    client.execute(&admin, &pid3);

    // Proposal needs exactly 2 votes
    let pid4 = client.propose(&admin, &ProposalAction::UpdateFee(300u32));
    client.vote(&admin, &pid4);

    // After 1 vote, still Pending
    let p = client.get_proposal(&pid4);
    assert_eq!(p.state, ProposalState::Pending);

    // Second vote reaches quorum exactly
    client.vote(&admin2, &pid4);
    let p2 = client.get_proposal(&pid4);
    assert_eq!(p2.state, ProposalState::Approved);

    client.execute(&admin, &pid4);
    let p3 = client.get_proposal(&pid4);
    assert_eq!(p3.state, ProposalState::Executed);
}

#[test]
fn test_quorum_one_below_threshold_does_not_execute() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Add two more admins
    let pid1 = client.propose(&admin, &ProposalAction::AddAdmin(admin2.clone()));
    client.vote(&admin, &pid1);
    client.execute(&admin, &pid1);

    let pid2 = client.propose(&admin, &ProposalAction::AddAdmin(admin3.clone()));
    client.vote(&admin, &pid2);
    client.execute(&admin, &pid2);

    // Set quorum to 3 (all admins must vote)
    let pid3 = client.propose(&admin, &ProposalAction::UpdateQuorum(3u32));
    client.vote(&admin, &pid3);
    client.execute(&admin, &pid3);

    // Proposal with only 2 votes (quorum - 1) stays Pending
    let pid4 = client.propose(&admin, &ProposalAction::UpdateFee(400u32));
    client.vote(&admin, &pid4);
    client.vote(&admin2, &pid4);

    let p = client.get_proposal(&pid4);
    assert_eq!(p.state, ProposalState::Pending);

    // Execute should fail — not yet Approved
    let result = client.try_execute(&admin, &pid4);
    assert_eq!(result, Err(Ok(ContractError::InvalidProposalState)));
}

// ── Admin removal via governance ──────────────────────────────────────────────

#[test]
fn test_remove_admin_via_governance_proposal() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Add admin2 via governance
    let pid1 = client.propose(&admin, &ProposalAction::AddAdmin(admin2.clone()));
    client.vote(&admin, &pid1);
    client.execute(&admin, &pid1);
    assert!(client.is_admin(&admin2));
    assert_eq!(client.get_admin_count(), 2u32);

    // Remove admin2 via governance (not direct remove_agent)
    let pid2 = client.propose(&admin, &ProposalAction::RemoveAdmin(admin2.clone()));
    client.vote(&admin, &pid2);
    client.execute(&admin, &pid2);

    assert!(!client.is_admin(&admin2));
    assert_eq!(client.get_admin_count(), 1u32);

    // admin2 can no longer propose
    let result = client.try_propose(&admin2, &ProposalAction::UpdateFee(100u32));
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

#[test]
fn test_remove_admin_below_quorum_rejected() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Add admin2
    let pid1 = client.propose(&admin, &ProposalAction::AddAdmin(admin2.clone()));
    client.vote(&admin, &pid1);
    client.execute(&admin, &pid1);

    // Raise quorum to 2 — now removing either admin would drop count below quorum
    let pid2 = client.propose(&admin, &ProposalAction::UpdateQuorum(2u32));
    client.vote(&admin, &pid2);
    client.vote(&admin2, &pid2);
    client.execute(&admin, &pid2);

    // Attempting to remove admin2 would leave count=1 < quorum=2
    let result = client.try_propose(&admin, &ProposalAction::RemoveAdmin(admin2.clone()));
    assert_eq!(result, Err(Ok(ContractError::InsufficientAdmins)));
}

// ── Re-vote prevention ────────────────────────────────────────────────────────

#[test]
fn test_same_admin_cannot_vote_twice_on_same_proposal() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Add admin2 and raise quorum to 2 so proposal stays Pending after first vote
    let pid0 = client.propose(&admin, &ProposalAction::AddAdmin(admin2.clone()));
    client.vote(&admin, &pid0);
    client.execute(&admin, &pid0);

    let pid1 = client.propose(&admin, &ProposalAction::UpdateQuorum(2u32));
    client.vote(&admin, &pid1);
    client.vote(&admin2, &pid1);
    client.execute(&admin, &pid1);

    let pid2 = client.propose(&admin, &ProposalAction::UpdateFee(500u32));
    client.vote(&admin, &pid2);

    // Same admin votes again — must fail
    let result = client.try_vote(&admin, &pid2);
    assert_eq!(result, Err(Ok(ContractError::AlreadyVoted)));

    // Proposal approval_count must still be 1
    let p = client.get_proposal(&pid2);
    assert_eq!(p.approval_count, 1u32);
}

#[test]
fn test_different_admins_can_each_vote_once() {
    let (env, client) = setup_env();
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    initialize(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Add two more admins
    let pid1 = client.propose(&admin, &ProposalAction::AddAdmin(admin2.clone()));
    client.vote(&admin, &pid1);
    client.execute(&admin, &pid1);

    let pid2 = client.propose(&admin, &ProposalAction::AddAdmin(admin3.clone()));
    client.vote(&admin, &pid2);
    client.execute(&admin, &pid2);

    // Set quorum to 3
    let pid3 = client.propose(&admin, &ProposalAction::UpdateQuorum(3u32));
    client.vote(&admin, &pid3);
    client.execute(&admin, &pid3);

    let pid4 = client.propose(&admin, &ProposalAction::UpdateFee(200u32));

    // Each admin votes once — should succeed
    client.vote(&admin, &pid4);
    client.vote(&admin2, &pid4);
    client.vote(&admin3, &pid4);

    let p = client.get_proposal(&pid4);
    assert_eq!(p.state, ProposalState::Approved);
    assert_eq!(p.approval_count, 3u32);
}
