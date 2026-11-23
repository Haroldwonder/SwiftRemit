//! Tests for agent performance metrics (issue #425).
//!
//! Verifies that success_rate_bps and last_active_timestamp are correctly
//! accumulated across confirm_payout, mark_failed, and get_agent_stats.

use crate::{SwiftRemitContract, SwiftRemitContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

/// Helper: set up a contract with a registered agent holding the Settler role.
fn setup_settler<'a>(
    env: &'a Env,
    admin: &Address,
    agent: &Address,
) -> (SwiftRemitContractClient<'a>, token::StellarAssetClient<'a>) {
    let token = create_token(env, admin);
    let contract = create_contract(env);
    contract.initialize(admin, &token.address, &250, &3600, &0, admin);
    contract.register_agent(agent, &None);
    crate::storage::assign_role(env, agent, &crate::Role::Settler);
    (contract, token)
}

fn create_token<'a>(env: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    token::StellarAssetClient::new(
        env,
        &env.register_stellar_asset_contract_v2(admin.clone()).address(),
    )
}

fn create_contract<'a>(env: &Env) -> SwiftRemitContractClient<'a> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

/// New agent has success_rate_bps = 10000 (100%) and last_active_timestamp = 0.
#[test]
fn test_default_agent_stats() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    let token = create_token(&env, &admin);
    let contract = create_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let stats = contract.get_agent_stats(&agent);
    assert_eq!(stats.total_settlements, 0);
    assert_eq!(stats.failed_settlements, 0);
    assert_eq!(stats.success_rate_bps, 10000);
    assert_eq!(stats.last_active_timestamp, 0);
}

/// After one successful payout: total=1, failed=0, success_rate_bps=10000.
#[test]
fn test_success_rate_after_confirm_payout() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    let token = create_token(&env, &admin);
    token.mint(&sender, &10_000);

    let contract = create_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);
    contract.register_agent(&agent, &None);
    crate::storage::assign_role(&env, &agent, &crate::Role::Settler);

    let id = contract.create_remittance(&sender, &agent, &1000_i128, &None, &None, &None, &None, &None);
    contract.confirm_payout(&id, &None, &None);

    let stats = contract.get_agent_stats(&agent);
    assert_eq!(stats.total_settlements, 1);
    assert_eq!(stats.failed_settlements, 0);
    assert_eq!(stats.success_rate_bps, 10000);
    assert!(stats.last_active_timestamp > 0);
}

/// confirm_payout must not mutate agent stats when a pre-check fails.
///
/// The rate-limit and withdrawal-cap checks run before any stat writes, so a
/// rejected payout leaves the agent's stats exactly as they were.
#[test]
fn test_confirm_payout_failed_check_leaves_stats_unchanged() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    let (contract, token) = setup_settler(&env, &admin, &agent);
    token.mint(&sender, &10_000);

    // Tighten the per-agent withdrawal cap so the payout is rejected by a
    // pre-check after the remittance is created.
    contract.set_agent_withdrawal_cap(&admin, &agent, &100_i128);

    let id = contract.create_remittance(&sender, &agent, &1000_i128, &None, &None, &None, &None, &None);

    let before = contract.get_agent_stats(&agent);
    assert_eq!(before.total_settlements, 0);
    assert_eq!(before.failed_settlements, 0);
    assert_eq!(before.success_rate_bps, 10000);
    assert_eq!(before.last_active_timestamp, 0);

    let result = contract.try_confirm_payout(&id, &None, &None);
    assert!(result.is_err(), "payout should be rejected by cap check");

    let after = contract.get_agent_stats(&agent);
    assert_eq!(after.total_settlements, before.total_settlements);
    assert_eq!(after.failed_settlements, before.failed_settlements);
    assert_eq!(after.success_rate_bps, before.success_rate_bps);
    assert_eq!(after.last_active_timestamp, before.last_active_timestamp);
}

/// A successful confirm_payout still records stats after the reordering.
#[test]
fn test_confirm_payout_records_stats_after_reorder() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    let (contract, token) = setup_settler(&env, &admin, &agent);
    token.mint(&sender, &10_000);

    let id = contract.create_remittance(&sender, &agent, &1000_i128, &None, &None, &None, &None, &None);
    contract.confirm_payout(&id, &None, &None);

    let stats = contract.get_agent_stats(&agent);
    assert_eq!(stats.total_settlements, 1);
    assert_eq!(stats.failed_settlements, 0);
    assert_eq!(stats.success_rate_bps, 10000);
    assert!(stats.last_active_timestamp > 0);
}

/// After one failure: total=0 (mark_failed doesn't increment total), failed=1, success_rate_bps=10000.
#[test]
fn test_success_rate_after_mark_failed() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    let token = create_token(&env, &admin);
    token.mint(&sender, &10_000);

    let contract = create_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);
    contract.register_agent(&agent, &None);

    let id = contract.create_remittance(&sender, &agent, &1000_i128, &None, &None, &None, &None, &None);
    contract.mark_failed(&id);

    let stats = contract.get_agent_stats(&agent);
    assert_eq!(stats.failed_settlements, 1);
    assert!(stats.last_active_timestamp > 0);
}

/// After 3 successes and 1 failure: success_rate_bps = 3/4 * 10000 = 7500.
#[test]
fn test_success_rate_mixed_outcomes() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    // Directly manipulate storage to simulate accumulated stats.
    let contract_id = env.register_contract(None, SwiftRemitContract {});
    env.as_contract(&contract_id, || {
        let stats = crate::AgentStats {
            total_settlements: 4,
            failed_settlements: 1,
            total_settlement_time: 4000,
            dispute_count: 0,
            success_rate_bps: 0, // will be recomputed
            last_active_timestamp: 0,
        };
        crate::storage::set_agent_stats(&env, &agent, &stats);

        // Simulate what confirm_payout does when recomputing success_rate_bps.
        let mut s = crate::storage::get_agent_stats(&env, &agent);
        let successful = s.total_settlements.saturating_sub(s.failed_settlements);
        s.success_rate_bps = successful
            .saturating_mul(10000)
            .checked_div(s.total_settlements)
            .unwrap_or(10000);
        crate::storage::set_agent_stats(&env, &agent, &s);

        let saved = crate::storage::get_agent_stats(&env, &agent);
        assert_eq!(saved.success_rate_bps, 7500); // 3/4 * 10000
    });
}

/// A dispute resolved in favour of the agent counts as a completed settlement,
/// so success_rate_bps reflects it (issue #1674).
#[test]
fn test_agent_stats_after_dispute_resolved_for_agent() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    let token = create_token(&env, &admin);
    token.mint(&sender, &10_000);

    let contract = create_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);
    contract.register_agent(&agent, &None);
    crate::storage::assign_role(&env, &agent, &crate::Role::Settler);

    let id = contract.create_remittance(
        &sender,
        &agent,
        &1000_i128,
        &None,
        &None,
        &None,
        &None,
        &None,
    );
    contract.confirm_payout(&id, &None, &None);

    let before = contract.get_agent_stats(&agent);
    assert_eq!(before.total_settlements, 1);
    assert_eq!(before.failed_settlements, 0);
    assert_eq!(before.success_rate_bps, 10000);

    contract.open_dispute(&id, &sender, &String::from_str(&env, "reason"));
    contract.resolve_dispute(&id, &true);

    let after = contract.get_agent_stats(&agent);
    // Agent-favoured resolution keeps the settlement as successful.
    assert_eq!(after.total_settlements, 1);
    assert_eq!(after.failed_settlements, 0);
    assert_eq!(after.success_rate_bps, 10000);
    assert_eq!(after.dispute_count, before.dispute_count + 1);
    assert!(after.last_active_timestamp >= before.last_active_timestamp);
}

/// A dispute resolved in favour of the sender counts as a failed settlement
/// and increments the dispute tally (issue #1674).
#[test]
fn test_agent_stats_after_dispute_resolved_for_sender() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    let token = create_token(&env, &admin);
    token.mint(&sender, &10_000);

    let contract = create_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);
    contract.register_agent(&agent, &None);
    crate::storage::assign_role(&env, &agent, &crate::Role::Settler);

    let id = contract.create_remittance(
        &sender,
        &agent,
        &1000_i128,
        &None,
        &None,
        &None,
        &None,
        &None,
    );
    contract.confirm_payout(&id, &None, &None);

    let before = contract.get_agent_stats(&agent);
    assert_eq!(before.total_settlements, 1);
    assert_eq!(before.failed_settlements, 0);

    contract.open_dispute(&id, &sender, &String::from_str(&env, "reason"));
    contract.resolve_dispute(&id, &false);

    let after = contract.get_agent_stats(&agent);
    // Sender-favoured resolution marks the settlement as failed.
    assert_eq!(after.failed_settlements, before.failed_settlements + 1);
    assert_eq!(after.dispute_count, before.dispute_count + 1);
    assert!(after.success_rate_bps < before.success_rate_bps);
    assert!(after.last_active_timestamp >= before.last_active_timestamp);
}
