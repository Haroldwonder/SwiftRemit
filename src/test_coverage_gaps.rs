//! Coverage gap tests for SwiftRemit — Issue #395
//!
//! Covers error conditions, branch paths, and query functions not exercised
//! by the existing test suite.

#![cfg(test)]

use crate::{
    fee_service::{FeeBreakdown},
    SwiftRemitContract, SwiftRemitContractClient,
};
use soroban_sdk::{testutils::Address as _, token, Address, Env};

// ── shared helpers ────────────────────────────────────────────────────────────

fn create_token<'a>(env: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    let id = env.register_stellar_asset_contract_v2(admin.clone());
    token::StellarAssetClient::new(env, &id.address())
}

fn new_contract<'a>(env: &Env) -> SwiftRemitContractClient<'a> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

/// Returns (contract, token, admin, agent, sender) with 10_000 tokens minted to sender.
fn setup(env: &Env) -> (SwiftRemitContractClient, token::StellarAssetClient, Address, Address, Address) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = create_token(env, &token_admin);
    let agent = Address::generate(env);
    let sender = Address::generate(env);
    let contract = new_contract(env);
    env.mock_all_auths();
    contract.initialize(&admin, &token.address, &250, &0, &0, &admin);
    contract.register_agent(&agent, &None);
    token.mint(&sender, &10_000);
    (contract, token, admin, agent, sender)
}

// ── initialization errors ─────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_double_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let contract = new_contract(&env);
    contract.initialize(&admin, &token.address, &250, &0, &0, &admin);
    contract.initialize(&admin, &token.address, &250, &0, &0, &admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_initialize_invalid_fee_bps() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let contract = new_contract(&env);
    // fee_bps > 10000 → InvalidFeeBps
    contract.initialize(&admin, &token.address, &10_001, &0, &0, &admin);
}

// ── create_remittance error paths ─────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_create_remittance_zero_amount() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup(&env);
    env.mock_all_auths();
    contract.create_remittance(&sender, &agent, &0, &None, &None, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_create_remittance_negative_amount() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup(&env);
    env.mock_all_auths();
    contract.create_remittance(&sender, &agent, &-1, &None, &None, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_create_remittance_agent_not_registered() {
    let env = Env::default();
    let (contract, _token, _admin, _agent, sender) = setup(&env);
    let unregistered = Address::generate(&env);
    env.mock_all_auths();
    contract.create_remittance(&sender, &unregistered, &1_000, &None, &None, &None);
}

// ── confirm_payout error paths ────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_confirm_payout_remittance_not_found() {
    let env = Env::default();
    let (contract, _token, _admin, _agent, _sender) = setup(&env);
    env.mock_all_auths();
    contract.confirm_payout(&9999, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_confirm_payout_already_completed() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup(&env);
    env.mock_all_auths();
    let id = contract.create_remittance(&sender, &agent, &1_000, &None, &None, &None);
    contract.confirm_payout(&id, &None);
    // Second confirm on a Completed remittance → InvalidStatus
    contract.confirm_payout(&id, &None);
}

// ── cancel_remittance error paths ─────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_cancel_remittance_not_found() {
    let env = Env::default();
    let (contract, _token, _admin, _agent, _sender) = setup(&env);
    env.mock_all_auths();
    contract.cancel_remittance(&9999);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_cancel_remittance_already_completed() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup(&env);
    env.mock_all_auths();
    let id = contract.create_remittance(&sender, &agent, &1_000, &None, &None, &None);
    contract.confirm_payout(&id, &None);
    contract.cancel_remittance(&id);
}

// ── update_fee error paths ────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_update_fee_invalid_bps() {
    let env = Env::default();
    let (contract, _token, _admin, _agent, _sender) = setup(&env);
    env.mock_all_auths();
    contract.update_fee(&10_001);
}

#[test]
fn test_update_fee_zero_bps() {
    let env = Env::default();
    let (contract, _token, _admin, _agent, _sender) = setup(&env);
    env.mock_all_auths();
    contract.update_fee(&0);
    assert_eq!(contract.get_platform_fee_bps(), 0);
}

#[test]
fn test_update_fee_max_bps() {
    let env = Env::default();
    let (contract, _token, _admin, _agent, _sender) = setup(&env);
    env.mock_all_auths();
    contract.update_fee(&10_000);
    assert_eq!(contract.get_platform_fee_bps(), 10_000);
}

// ── withdraw_fees error paths ─────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_withdraw_fees_when_empty() {
    let env = Env::default();
    let (contract, _token, admin, _agent, _sender) = setup(&env);
    env.mock_all_auths();
    // No remittances completed → accumulated fees = 0 → NoFeesToWithdraw
    contract.withdraw_fees(&admin);
}

#[test]
fn test_withdraw_fees_after_payout() {
    let env = Env::default();
    let (contract, token, admin, agent, sender) = setup(&env);
    env.mock_all_auths();
    let id = contract.create_remittance(&sender, &agent, &1_000, &None, &None, &None);
    contract.confirm_payout(&id, &None);
    // Fees should now be > 0
    let fees = contract.get_accumulated_fees();
    assert!(fees > 0, "expected accumulated fees after payout");
    let recipient = Address::generate(&env);
    contract.withdraw_fees(&recipient);
    assert_eq!(contract.get_accumulated_fees(), 0);
    let _ = token; // suppress unused warning
}

// ── query functions ───────────────────────────────────────────────────────────

#[test]
fn test_get_remittance_count_increments() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup(&env);
    env.mock_all_auths();
    assert_eq!(contract.get_remittance_count(), 0);
    contract.create_remittance(&sender, &agent, &1_000, &None, &None, &None);
    assert_eq!(contract.get_remittance_count(), 1);
    contract.create_remittance(&sender, &agent, &500, &None, &None, &None);
    assert_eq!(contract.get_remittance_count(), 2);
}

#[test]
fn test_get_total_volume_after_completions() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup(&env);
    env.mock_all_auths();
    assert_eq!(contract.get_total_volume(), 0);
    let id1 = contract.create_remittance(&sender, &agent, &1_000, &None, &None, &None);
    contract.confirm_payout(&id1, &None);
    assert_eq!(contract.get_total_volume(), 1_000);
    let id2 = contract.create_remittance(&sender, &agent, &2_000, &None, &None, &None);
    contract.confirm_payout(&id2, &None);
    assert_eq!(contract.get_total_volume(), 3_000);
}

#[test]
fn test_get_admin_count() {
    let env = Env::default();
    let (contract, _token, _admin, _agent, _sender) = setup(&env);
    env.mock_all_auths();
    assert_eq!(contract.get_admin_count(), 1);
}

#[test]
fn test_is_agent_registered() {
    let env = Env::default();
    let (contract, _token, _admin, agent, _sender) = setup(&env);
    env.mock_all_auths();
    assert!(contract.is_agent_registered(&agent));
    let stranger = Address::generate(&env);
    assert!(!contract.is_agent_registered(&stranger));
}

#[test]
fn test_get_remittance_returns_correct_data() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup(&env);
    env.mock_all_auths();
    let id = contract.create_remittance(&sender, &agent, &1_000, &None, &None, &None);
    let r = contract.get_remittance(&id);
    assert_eq!(r.sender, sender);
    assert_eq!(r.agent, agent);
    assert_eq!(r.amount, 1_000);
}

// ── FeeBreakdown::validate() branch coverage ──────────────────────────────────

#[test]
fn test_fee_breakdown_validate_ok() {
    let env = Env::default();
    let bd = FeeBreakdown {
        amount: 1_000,
        platform_fee: 25,
        protocol_fee: 0,
        net_amount: 975,
        corridor: None,
    };
    assert!(bd.validate().is_ok());
    let _ = env;
}

#[test]
fn test_fee_breakdown_validate_mismatch() {
    let env = Env::default();
    let bd = FeeBreakdown {
        amount: 1_000,
        platform_fee: 25,
        protocol_fee: 0,
        net_amount: 900, // wrong — doesn't sum to 1000
        corridor: None,
    };
    assert!(bd.validate().is_err());
    let _ = env;
}

#[test]
fn test_fee_breakdown_validate_negative_amount() {
    let env = Env::default();
    let bd = FeeBreakdown {
        amount: -1,
        platform_fee: 0,
        protocol_fee: 0,
        net_amount: -1,
        corridor: None,
    };
    assert!(bd.validate().is_err());
    let _ = env;
}

#[test]
fn test_fee_breakdown_validate_negative_fee() {
    let env = Env::default();
    let bd = FeeBreakdown {
        amount: 1_000,
        platform_fee: -25,
        protocol_fee: 0,
        net_amount: 1_025,
        corridor: None,
    };
    assert!(bd.validate().is_err());
    let _ = env;
}
