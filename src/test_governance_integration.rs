//! End-to-end governance integration tests.
//!
//! Validates the full propose → vote → execute cycle for each proposal type
//! with a realistic 3-admin quorum.  These tests mirror the acceptance criterion:
//! "A 3-admin quorum can propose, vote on, and execute a fee rate change."

#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Vec,
};

use crate::{
    ContractError, ProposalAction, ProposalState, SwiftRemitContract,
    SwiftRemitContractClient,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn setup() -> (Env, SwiftRemitContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &id);
    (env, client)
}

fn init(env: &Env, client: &SwiftRemitContractClient, admin: &Address) {
    let token = Address::generate(env);
    client.initialize(admin, &token, &30u32, &0u64, &0u32, admin);
}

fn advance(env: &Env, secs: u64) {
    env.ledger().with_mut(|l| l.timestamp += secs);
}

// Bootstrap: 3 admins with quorum=3 and no timelock.
fn setup_three_admin_governance() -> (Env, SwiftRemitContractClient<'static>, Address, Address, Address) {
    let (env, client) = setup();
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);

    init(&env, &client, &admin1);
    client.migrate_to_governance(&admin1, &1u32, &0u64, &604_800u64);

    // Add admin2
    let pid = client.propose(&admin1, &ProposalAction::AddAdmin(admin2.clone()));
    client.vote(&admin1, &pid);
    client.execute(&admin1, &pid);

    // Add admin3
    let pid = client.propose(&admin1, &ProposalAction::AddAdmin(admin3.clone()));
    client.vote(&admin1, &pid);
    client.execute(&admin1, &pid);

    // Raise quorum to 3
    let pid = client.propose(&admin1, &ProposalAction::UpdateQuorum(3u32));
    client.vote(&admin1, &pid);
    client.execute(&admin1, &pid);

    assert_eq!(client.get_quorum(), 3u32);
    assert_eq!(client.get_admin_count(), 3u32);

    (env, client, admin1, admin2, admin3)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Full fee-change lifecycle with 3-admin quorum
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_three_admin_fee_change_end_to_end() {
    let (env, client, admin1, admin2, admin3) = setup_three_admin_governance();

    let new_fee_bps: u32 = 300; // 3 %

    // Propose
    let pid = client.propose(&admin1, &ProposalAction::UpdateFee(new_fee_bps));
    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.state, ProposalState::Pending);
    assert_eq!(proposal.approval_count, 0u32);

    // Vote 1 — still pending
    client.vote(&admin1, &pid);
    let p = client.get_proposal(&pid);
    assert_eq!(p.state, ProposalState::Pending);
    assert_eq!(p.approval_count, 1u32);

    // Vote 2 — still pending (need 3)
    client.vote(&admin2, &pid);
    let p = client.get_proposal(&pid);
    assert_eq!(p.state, ProposalState::Pending);
    assert_eq!(p.approval_count, 2u32);

    // Vote 3 — quorum reached → Approved
    client.vote(&admin3, &pid);
    let p = client.get_proposal(&pid);
    assert_eq!(p.state, ProposalState::Approved);
    assert_eq!(p.approval_count, 3u32);
    assert!(p.approval_timestamp.is_some());

    // Execute (timelock = 0, so immediate)
    client.execute(&admin1, &pid);
    let p = client.get_proposal(&pid);
    assert_eq!(p.state, ProposalState::Executed);

    // Fee is now updated
    let fee = client.get_platform_fee_bps().unwrap();
    assert_eq!(fee, new_fee_bps);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Timelock enforcement
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_timelock_prevents_early_execution() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    init(&env, &client, &admin);
    // quorum=1, timelock=3600 s
    client.migrate_to_governance(&admin, &1u32, &3600u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(200u32));
    client.vote(&admin, &pid);

    // Proposal is approved but timelock has not elapsed
    let p = client.get_proposal(&pid);
    assert_eq!(p.state, ProposalState::Approved);

    let result = client.try_execute(&admin, &pid);
    assert_eq!(result, Err(Ok(ContractError::TimelockActive)));

    // Advance past timelock
    advance(&env, 3601);
    client.execute(&admin, &pid);
    let p = client.get_proposal(&pid);
    assert_eq!(p.state, ProposalState::Executed);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Proposal expiry
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_proposal_expires_when_ttl_elapses() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    init(&env, &client, &admin);
    // ttl = 600 s (10 minutes)
    client.migrate_to_governance(&admin, &1u32, &0u64, &600u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));

    // Cannot expire before TTL
    let result = client.try_expire_proposal(&pid);
    assert!(result.is_err());

    // Advance past TTL
    advance(&env, 601);
    client.expire_proposal(&pid);

    // Proposal is gone from storage; get_proposal returns ProposalNotFound
    let result = client.try_get_proposal(&pid);
    assert_eq!(result, Err(Ok(ContractError::ProposalNotFound)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Admin management lifecycle via governance
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_add_then_remove_admin_via_governance() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let newcomer = Address::generate(&env);
    init(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Add newcomer
    let pid = client.propose(&admin, &ProposalAction::AddAdmin(newcomer.clone()));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);
    assert!(client.is_admin(&newcomer));
    assert_eq!(client.get_admin_count(), 2u32);

    // Remove newcomer — quorum is still 1, admin count goes to 1, which equals quorum
    // so count-after-removal (1) >= quorum (1): allowed
    let pid2 = client.propose(&admin, &ProposalAction::RemoveAdmin(newcomer.clone()));
    client.vote(&admin, &pid2);
    client.execute(&admin, &pid2);
    assert!(!client.is_admin(&newcomer));
    assert_eq!(client.get_admin_count(), 1u32);
}

#[test]
fn test_cannot_remove_last_admin() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    init(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Attempt to remove the sole admin — must fail at proposal time
    let result = client.try_propose(&admin, &ProposalAction::RemoveAdmin(admin.clone()));
    assert_eq!(result, Err(Ok(ContractError::InsufficientAdmins)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Agent registration lifecycle via governance
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_agent_register_and_remove_lifecycle() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    init(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Register agent
    let pid = client.propose(&admin, &ProposalAction::RegisterAgent(agent.clone()));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);
    assert!(client.is_agent_registered(&agent));

    // Remove agent
    let pid2 = client.propose(&admin, &ProposalAction::RemoveAgent(agent.clone()));
    client.vote(&admin, &pid2);
    client.execute(&admin, &pid2);
    assert!(!client.is_agent_registered(&agent));
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Security invariants
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_non_admin_cannot_propose() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let outsider = Address::generate(&env);
    init(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let result = client.try_propose(&outsider, &ProposalAction::UpdateFee(100u32));
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

#[test]
fn test_non_admin_cannot_vote() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let outsider = Address::generate(&env);
    init(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    let result = client.try_vote(&outsider, &pid);
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

#[test]
fn test_double_vote_rejected() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    init(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Use quorum=2 so the first vote doesn't immediately execute
    let pid_q = client.propose(&admin, &ProposalAction::AddAdmin(Address::generate(&env)));
    client.vote(&admin, &pid_q);
    client.execute(&admin, &pid_q);
    let pid_q2 = client.propose(&admin, &ProposalAction::UpdateQuorum(2u32));
    client.vote(&admin, &pid_q2);
    client.execute(&admin, &pid_q2);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(250u32));
    client.vote(&admin, &pid);

    let result = client.try_vote(&admin, &pid);
    assert_eq!(result, Err(Ok(ContractError::AlreadyVoted)));
}

#[test]
fn test_executed_proposal_cannot_be_re_executed() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    init(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);

    let result = client.try_execute(&admin, &pid);
    assert_eq!(result, Err(Ok(ContractError::InvalidProposalState)));
}

#[test]
fn test_proposal_rejected_when_contract_is_paused() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    init(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Pause the contract
    client.pause();

    let result = client.try_propose(&admin, &ProposalAction::UpdateFee(100u32));
    assert_eq!(result, Err(Ok(ContractError::ContractPaused)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Quorum and timelock update via governance
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_update_quorum_via_governance() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    init(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    // Add admin2 so quorum=2 is valid
    let pid = client.propose(&admin, &ProposalAction::AddAdmin(admin2.clone()));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);

    // Raise quorum to 2
    let pid2 = client.propose(&admin, &ProposalAction::UpdateQuorum(2u32));
    client.vote(&admin, &pid2);
    client.execute(&admin, &pid2);
    assert_eq!(client.get_quorum(), 2u32);
}

#[test]
fn test_update_timelock_via_governance() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    init(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateTimelock(7200u64));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);
    assert_eq!(client.get_timelock_seconds(), 7200u64);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Proposal cleanup
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_cleanup_executed_proposals() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    init(&env, &client, &admin);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);

    let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
    client.vote(&admin, &pid);
    client.execute(&admin, &pid);

    // Cleanup should succeed and remove the proposal
    let mut ids = Vec::new(&env);
    ids.push_back(pid);
    client.cleanup_expired_proposals(&admin, &ids);

    // Proposal is gone
    let result = client.try_get_proposal(&pid);
    assert_eq!(result, Err(Ok(ContractError::ProposalNotFound)));
}
