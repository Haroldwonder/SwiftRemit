//! Property-based tests for the multi-admin / DAO governance module.
//!
//! Each test verifies a universal correctness property across randomized inputs.
//! Minimum 100 iterations per property (proptest default).
//!
//! Feature: multi-admin-dao-governance

#![cfg(test)]

extern crate std;

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

use crate::{ContractError, ProposalAction, ProposalState, SwiftRemitContract, SwiftRemitContractClient};

// ─────────────────────────────────────────────────────────────────────────────
// Shared setup helpers
// ─────────────────────────────────────────────────────────────────────────────

fn make_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

fn make_client(env: &Env) -> (SwiftRemitContractClient<'static>, Address) {
    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token = Address::generate(env);
    client.initialize(&admin, &token, &30u32, &0u32, &admin, &0u32);
    client.migrate_to_governance(&admin, &1u32, &0u64, &604_800u64);
    (client, admin)
}

fn advance(env: &Env, seconds: u64) {
    let info = env.ledger().get();
    env.ledger().set(LedgerInfo {
        timestamp: info.timestamp + seconds,
        ..info
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// P1: Admin count bounds invariant
// Feature: multi-admin-dao-governance, Property 1: admin count == Role::Admin holders, in [1,20]
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_admin_count_bounds(adds in 1usize..=5usize) {
        // Feature: multi-admin-dao-governance, Property 1: admin count == Role::Admin holders, in [1,20]
        let env = make_env();
        let (client, admin) = make_client(&env);

        let mut added: std::vec::Vec<Address> = std::vec![];
        for _ in 0..adds {
            let new_admin = Address::generate(&env);
            let pid = client.propose(&admin, &ProposalAction::AddAdmin(new_admin.clone()));
            client.vote(&admin, &pid);
            client.execute(&admin, &pid);
            added.push(new_admin);
        }

        let count = client.get_admin_count();
        prop_assert!(count >= 1);
        prop_assert!(count <= 20);
        prop_assert_eq!(count as usize, adds + 1); // original admin + adds
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P2: get_admins() matches Role::Admin holders
// Feature: multi-admin-dao-governance, Property 2: get_admins() == set of Role::Admin holders
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_admin_list_matches_role_holders(adds in 1usize..=4usize) {
        // Feature: multi-admin-dao-governance, Property 2: get_admins() == set of Role::Admin holders
        let env = make_env();
        let (client, admin) = make_client(&env);

        let mut expected: std::vec::Vec<Address> = std::vec![admin.clone()];
        for _ in 0..adds {
            let new_admin = Address::generate(&env);
            let pid = client.propose(&admin, &ProposalAction::AddAdmin(new_admin.clone()));
            client.vote(&admin, &pid);
            client.execute(&admin, &pid);
            expected.push(new_admin);
        }

        let admins = client.get_admins();
        prop_assert_eq!(admins.len() as usize, expected.len());
        for addr in &expected {
            prop_assert!(client.is_admin(addr));
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P3: Invalid quorum values are always rejected
// Feature: multi-admin-dao-governance, Property 3: quorum=0 or quorum>admin_count → InvalidQuorum
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_invalid_quorum_rejected(bad_quorum in prop_oneof![Just(0u32), 3u32..=100u32]) {
        // Feature: multi-admin-dao-governance, Property 3: quorum=0 or quorum>admin_count → InvalidQuorum
        let env = make_env();
        let contract_id = env.register_contract(None, SwiftRemitContract);
        let client = SwiftRemitContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        client.initialize(&admin, &token, &30u32, &0u32, &admin, &0u32);

        // admin_count = 1; quorum=0 or quorum>1 should fail
        let result = client.try_migrate_to_governance(&admin, &bad_quorum, &0u64, &604_800u64);
        prop_assert_eq!(result, Err(Ok(ContractError::InvalidQuorum)));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P4: Valid quorum update round-trip
// Feature: multi-admin-dao-governance, Property 4: valid quorum update round-trip
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_quorum_update_round_trip(new_quorum in 1u32..=2u32) {
        // Feature: multi-admin-dao-governance, Property 4: valid quorum update round-trip
        let env = make_env();
        let (client, admin) = make_client(&env);

        // Add a second admin so quorum=2 is valid
        let admin2 = Address::generate(&env);
        let pid0 = client.propose(&admin, &ProposalAction::AddAdmin(admin2.clone()));
        client.vote(&admin, &pid0);
        client.execute(&admin, &pid0);

        let pid = client.propose(&admin, &ProposalAction::UpdateQuorum(new_quorum));
        client.vote(&admin, &pid);
        if new_quorum == 2 {
            client.vote(&admin2, &pid);
        }
        client.execute(&admin, &pid);

        prop_assert_eq!(client.get_quorum(), new_quorum);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P5: Timelock update round-trip
// Feature: multi-admin-dao-governance, Property 5: timelock update round-trip
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_timelock_update_round_trip(seconds in 0u64..=86_400u64) {
        // Feature: multi-admin-dao-governance, Property 5: timelock update round-trip
        let env = make_env();
        let (client, admin) = make_client(&env);

        let pid = client.propose(&admin, &ProposalAction::UpdateTimelock(seconds));
        client.vote(&admin, &pid);
        client.execute(&admin, &pid);

        prop_assert_eq!(client.get_timelock_seconds(), seconds);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P6: Proposal IDs are unique and monotonically increasing
// Feature: multi-admin-dao-governance, Property 6: proposal IDs are strictly increasing
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_proposal_ids_monotonically_increasing(n in 2usize..=6usize) {
        // Feature: multi-admin-dao-governance, Property 6: proposal IDs are strictly increasing
        let env = make_env();
        let (client, admin) = make_client(&env);

        let mut ids: std::vec::Vec<u64> = std::vec![];
        for i in 0..n {
            let bps = (i as u32) * 10;
            let pid = client.propose(&admin, &ProposalAction::UpdateTimelock(bps as u64));
            ids.push(pid);
        }

        for i in 1..ids.len() {
            prop_assert!(ids[i] > ids[i - 1]);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P7: Non-admin callers always get Unauthorized
// Feature: multi-admin-dao-governance, Property 7: non-admin callers get Unauthorized
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_non_admin_unauthorized(_seed in 0u32..=100u32) {
        // Feature: multi-admin-dao-governance, Property 7: non-admin callers get Unauthorized
        let env = make_env();
        let (client, admin) = make_client(&env);
        let other = Address::generate(&env);

        let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));

        let r1 = client.try_propose(&other, &ProposalAction::UpdateTimelock(0u64));
        prop_assert_eq!(r1, Err(Ok(ContractError::Unauthorized)));

        let r2 = client.try_vote(&other, &pid);
        prop_assert_eq!(r2, Err(Ok(ContractError::Unauthorized)));

        let r3 = client.try_execute(&other, &pid);
        prop_assert_eq!(r3, Err(Ok(ContractError::Unauthorized)));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P8: Double-vote always returns AlreadyVoted
// Feature: multi-admin-dao-governance, Property 8: double-vote returns AlreadyVoted
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_double_vote_rejected(_seed in 0u32..=100u32) {
        // Feature: multi-admin-dao-governance, Property 8: double-vote returns AlreadyVoted
        let env = make_env();
        let (client, admin) = make_client(&env);

        // Use a 2-admin, quorum-2 setup so the proposal stays Pending after first vote
        let admin2 = Address::generate(&env);
        let pid0 = client.propose(&admin, &ProposalAction::AddAdmin(admin2.clone()));
        client.vote(&admin, &pid0);
        client.execute(&admin, &pid0);

        let pid1 = client.propose(&admin, &ProposalAction::UpdateQuorum(2u32));
        client.vote(&admin, &pid1);
        client.vote(&admin2, &pid1);
        client.execute(&admin, &pid1);

        let pid2 = client.propose(&admin, &ProposalAction::UpdateTimelock(60u64));
        client.vote(&admin, &pid2);
        let result = client.try_vote(&admin, &pid2);
        prop_assert_eq!(result, Err(Ok(ContractError::AlreadyVoted)));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P9: Exactly Q votes transitions proposal to Approved
// Feature: multi-admin-dao-governance, Property 9: Q votes → Approved state
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_quorum_triggers_approved(extra_admins in 1usize..=3usize) {
        // Feature: multi-admin-dao-governance, Property 9: Q votes → Approved state
        let env = make_env();
        let (client, admin) = make_client(&env);

        let mut all_admins: std::vec::Vec<Address> = std::vec![admin.clone()];
        for _ in 0..extra_admins {
            let a = Address::generate(&env);
            let pid = client.propose(&admin, &ProposalAction::AddAdmin(a.clone()));
            client.vote(&admin, &pid);
            client.execute(&admin, &pid);
            all_admins.push(a);
        }

        // Set quorum = total admin count
        let q = all_admins.len() as u32;
        let pid_q = client.propose(&admin, &ProposalAction::UpdateQuorum(q));
        for a in &all_admins {
            client.vote(a, &pid_q);
        }
        client.execute(&admin, &pid_q);

        // Now create a proposal and vote with all admins
        let pid = client.propose(&admin, &ProposalAction::UpdateTimelock(10u64));
        for (i, a) in all_admins.iter().enumerate() {
            let p = client.get_proposal(&pid);
            if i < all_admins.len() - 1 {
                prop_assert_eq!(p.state, ProposalState::Pending);
            }
            client.vote(a, &pid);
        }
        let final_p = client.get_proposal(&pid);
        prop_assert_eq!(final_p.state, ProposalState::Approved);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P10: Wrong-state execute returns InvalidProposalState; replay blocked
// Feature: multi-admin-dao-governance, Property 10: wrong-state execute → InvalidProposalState
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_wrong_state_execute_rejected(_seed in 0u32..=100u32) {
        // Feature: multi-admin-dao-governance, Property 10: wrong-state execute → InvalidProposalState
        let env = make_env();
        let (client, admin) = make_client(&env);

        // Pending proposal — execute should fail
        let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
        let r1 = client.try_execute(&admin, &pid);
        prop_assert_eq!(r1, Err(Ok(ContractError::InvalidProposalState)));

        // Execute after approval
        client.vote(&admin, &pid);
        client.execute(&admin, &pid);

        // Replay — should fail
        let r2 = client.try_execute(&admin, &pid);
        prop_assert_eq!(r2, Err(Ok(ContractError::InvalidProposalState)));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P11: expire_proposal succeeds after TTL
// Feature: multi-admin-dao-governance, Property 11: expire_proposal succeeds after TTL
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_expire_after_ttl(ttl in 10u64..=1000u64) {
        // Feature: multi-admin-dao-governance, Property 11: expire_proposal succeeds after TTL
        let env = make_env();
        let contract_id = env.register_contract(None, SwiftRemitContract);
        let client = SwiftRemitContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        client.initialize(&admin, &token, &30u32, &0u32, &admin, &0u32);
        client.migrate_to_governance(&admin, &1u32, &0u64, &ttl);

        let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
        advance(&env, ttl + 1);
        client.expire_proposal(&pid);

        let p = client.get_proposal(&pid);
        prop_assert_eq!(p.state, ProposalState::Expired);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P12: Fee update proposal round-trip
// Feature: multi-admin-dao-governance, Property 12: fee update round-trip
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_fee_update_round_trip(bps in 0u32..=10_000u32) {
        // Feature: multi-admin-dao-governance, Property 12: fee update round-trip
        let env = make_env();
        let (client, admin) = make_client(&env);

        let pid = client.propose(&admin, &ProposalAction::UpdateFee(bps));
        client.vote(&admin, &pid);
        client.execute(&admin, &pid);

        prop_assert_eq!(client.get_platform_fee_bps().unwrap(), bps);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P13: fee_bps > 10000 rejected at propose time
// Feature: multi-admin-dao-governance, Property 13: fee_bps > 10000 → InvalidFeeBps
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_invalid_fee_bps_rejected(bps in 10_001u32..=u32::MAX) {
        // Feature: multi-admin-dao-governance, Property 13: fee_bps > 10000 → InvalidFeeBps
        let env = make_env();
        let (client, admin) = make_client(&env);

        let result = client.try_propose(&admin, &ProposalAction::UpdateFee(bps));
        prop_assert_eq!(result, Err(Ok(ContractError::InvalidFeeBps)));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P14: Second active fee proposal returns ProposalAlreadyPending
// Feature: multi-admin-dao-governance, Property 14: second fee proposal → ProposalAlreadyPending
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_duplicate_fee_proposal_rejected(_seed in 0u32..=100u32) {
        // Feature: multi-admin-dao-governance, Property 14: second fee proposal → ProposalAlreadyPending
        let env = make_env();
        let (client, admin) = make_client(&env);

        client.propose(&admin, &ProposalAction::UpdateFee(100u32));
        let result = client.try_propose(&admin, &ProposalAction::UpdateFee(200u32));
        prop_assert_eq!(result, Err(Ok(ContractError::ProposalAlreadyPending)));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P15: Agent register/remove round-trip
// Feature: multi-admin-dao-governance, Property 15: agent register/remove round-trip
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_agent_round_trip(_seed in 0u32..=100u32) {
        // Feature: multi-admin-dao-governance, Property 15: agent register/remove round-trip
        let env = make_env();
        let (client, admin) = make_client(&env);
        let agent = Address::generate(&env);

        prop_assert!(!client.is_agent_registered(&agent));

        let pid1 = client.propose(&admin, &ProposalAction::RegisterAgent(agent.clone()));
        client.vote(&admin, &pid1);
        client.execute(&admin, &pid1);
        prop_assert!(client.is_agent_registered(&agent));

        let pid2 = client.propose(&admin, &ProposalAction::RemoveAgent(agent.clone()));
        client.vote(&admin, &pid2);
        client.execute(&admin, &pid2);
        prop_assert!(!client.is_agent_registered(&agent));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P16: Single-admin mode allows immediate execution
// Feature: multi-admin-dao-governance, Property 16: single-admin mode → immediate execution
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_single_admin_immediate_execution(bps in 0u32..=10_000u32) {
        // Feature: multi-admin-dao-governance, Property 16: single-admin mode → immediate execution
        let env = make_env();
        let (client, admin) = make_client(&env);

        let pid = client.propose(&admin, &ProposalAction::UpdateFee(bps));
        client.vote(&admin, &pid);
        client.execute(&admin, &pid);

        let p = client.get_proposal(&pid);
        prop_assert_eq!(p.state, ProposalState::Executed);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P17: approval_count never exceeds admin count
// Feature: multi-admin-dao-governance, Property 17: approval_count <= admin_count always
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_approval_count_never_exceeds_admin_count(extra in 0usize..=3usize) {
        // Feature: multi-admin-dao-governance, Property 17: approval_count <= admin_count always
        let env = make_env();
        let (client, admin) = make_client(&env);

        let mut all_admins: std::vec::Vec<Address> = std::vec![admin.clone()];
        for _ in 0..extra {
            let a = Address::generate(&env);
            let pid = client.propose(&admin, &ProposalAction::AddAdmin(a.clone()));
            client.vote(&admin, &pid);
            client.execute(&admin, &pid);
            all_admins.push(a);
        }

        // Set quorum to total count so proposal stays Pending while voting
        let q = all_admins.len() as u32;
        let pid_q = client.propose(&admin, &ProposalAction::UpdateQuorum(q));
        for a in &all_admins {
            client.vote(a, &pid_q);
        }
        client.execute(&admin, &pid_q);

        let pid = client.propose(&admin, &ProposalAction::UpdateTimelock(5u64));
        for a in &all_admins {
            client.vote(a, &pid);
            let p = client.get_proposal(&pid);
            prop_assert!(p.approval_count <= client.get_admin_count());
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P18: propose while paused returns ContractPaused
// Feature: multi-admin-dao-governance, Property 18: propose while paused → ContractPaused
// ─────────────────────────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn prop_propose_while_paused_rejected(_seed in 0u32..=100u32) {
        // Feature: multi-admin-dao-governance, Property 18: propose while paused → ContractPaused
        let env = make_env();
        let (client, admin) = make_client(&env);

        // Pause the contract
        client.pause(&admin);

        let result = client.try_propose(&admin, &ProposalAction::UpdateFee(100u32));
        prop_assert_eq!(result, Err(Ok(ContractError::ContractPaused)));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #540 — Property tests for quorum invariants
// ─────────────────────────────────────────────────────────────────────────────

// ── P19: Exactly Q votes always transitions to Approved, Q-1 never does ──────

proptest! {
    #[test]
    fn prop_quorum_boundary_approved_vs_pending(extra_admins in 1usize..=3usize) {
        // Feature: multi-admin-dao-governance
        // Property 19: exactly Q votes → Approved; Q-1 votes → Pending
        let env = make_env();
        let (client, admin) = make_client(&env);

        let mut all_admins: std::vec::Vec<Address> = std::vec![admin.clone()];
        for _ in 0..extra_admins {
            let a = Address::generate(&env);
            let pid = client.propose(&admin, &ProposalAction::AddAdmin(a.clone()));
            client.vote(&admin, &pid);
            client.execute(&admin, &pid);
            all_admins.push(a);
        }

        let q = all_admins.len() as u32;
        // Set quorum to total admin count
        let pid_q = client.propose(&admin, &ProposalAction::UpdateQuorum(q));
        for a in &all_admins {
            client.vote(a, &pid_q);
        }
        client.execute(&admin, &pid_q);

        // Create a proposal and cast Q-1 votes — must stay Pending
        let pid = client.propose(&admin, &ProposalAction::UpdateTimelock(42u64));
        for a in all_admins.iter().take(all_admins.len() - 1) {
            client.vote(a, &pid);
        }
        let p_before = client.get_proposal(&pid);
        prop_assert_eq!(p_before.state, ProposalState::Pending);

        // Cast the Q-th vote — must transition to Approved
        client.vote(all_admins.last().unwrap(), &pid);
        let p_after = client.get_proposal(&pid);
        prop_assert_eq!(p_after.state, ProposalState::Approved);
    }
}

// ── P20: Admin count never drops below quorum after RemoveAdmin ───────────────

proptest! {
    #[test]
    fn prop_admin_count_never_below_quorum(extra_admins in 1usize..=3usize) {
        // Feature: multi-admin-dao-governance
        // Property 20: admin_count >= quorum invariant holds after any RemoveAdmin
        let env = make_env();
        let (client, admin) = make_client(&env);

        let mut all_admins: std::vec::Vec<Address> = std::vec![admin.clone()];
        for _ in 0..extra_admins {
            let a = Address::generate(&env);
            let pid = client.propose(&admin, &ProposalAction::AddAdmin(a.clone()));
            client.vote(&admin, &pid);
            client.execute(&admin, &pid);
            all_admins.push(a);
        }

        // Remove admins one by one (keeping quorum=1 so removal is always valid)
        // We can remove all but the original admin
        for a in all_admins.iter().skip(1) {
            let pid = client.propose(&admin, &ProposalAction::RemoveAdmin(a.clone()));
            client.vote(&admin, &pid);
            client.execute(&admin, &pid);

            let count = client.get_admin_count();
            let quorum = client.get_quorum();
            prop_assert!(count >= quorum, "admin_count {} < quorum {}", count, quorum);
            prop_assert!(count >= 1);
        }
    }
}

// ── P21: Timelock prevents execution until elapsed ────────────────────────────

proptest! {
    #[test]
    fn prop_timelock_blocks_early_execution(timelock in 1u64..=3600u64) {
        // Feature: multi-admin-dao-governance
        // Property 21: execute before timelock → TimelockNotElapsed; after → succeeds
        let env = make_env();
        let contract_id = env.register_contract(None, SwiftRemitContract);
        let client = SwiftRemitContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        client.initialize(&admin, &token, &30u32, &0u32, &admin, &0u32);
        client.migrate_to_governance(&admin, &1u32, &timelock, &604_800u64);

        let pid = client.propose(&admin, &ProposalAction::UpdateFee(100u32));
        client.vote(&admin, &pid);

        // One second before timelock — must fail
        advance(&env, timelock - 1);
        let r = client.try_execute(&admin, &pid);
        prop_assert_eq!(r, Err(Ok(ContractError::TimelockNotElapsed)));

        // Advance to exactly the boundary — must succeed
        advance(&env, 1);
        client.execute(&admin, &pid);
        let p = client.get_proposal(&pid);
        prop_assert_eq!(p.state, ProposalState::Approved); // state is set to Executed after execute
        // Re-read to confirm Executed
        let p2 = client.get_proposal(&pid);
        prop_assert_eq!(p2.state, ProposalState::Executed);
    }
}

// ── P22: Double-vote invariant across arbitrary admin counts ──────────────────

proptest! {
    #[test]
    fn prop_double_vote_always_rejected_multi_admin(extra in 1usize..=3usize) {
        // Feature: multi-admin-dao-governance
        // Property 22: any admin voting twice on the same proposal → AlreadyVoted
        let env = make_env();
        let (client, admin) = make_client(&env);

        let mut all_admins: std::vec::Vec<Address> = std::vec![admin.clone()];
        for _ in 0..extra {
            let a = Address::generate(&env);
            let pid = client.propose(&admin, &ProposalAction::AddAdmin(a.clone()));
            client.vote(&admin, &pid);
            client.execute(&admin, &pid);
            all_admins.push(a);
        }

        // Set quorum to total so proposal stays Pending while we test double-vote
        let q = all_admins.len() as u32;
        let pid_q = client.propose(&admin, &ProposalAction::UpdateQuorum(q));
        for a in &all_admins {
            client.vote(a, &pid_q);
        }
        client.execute(&admin, &pid_q);

        let pid = client.propose(&admin, &ProposalAction::UpdateTimelock(99u64));

        // Each admin votes once, then tries again — second vote must always fail
        for a in &all_admins {
            client.vote(a, &pid);
            let result = client.try_vote(a, &pid);
            prop_assert_eq!(result, Err(Ok(ContractError::AlreadyVoted)));
        }
    }
}
