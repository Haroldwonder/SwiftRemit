#![cfg(test)]

use crate::{SwiftRemitContract, SwiftRemitContractClient, FeeStrategy, FeeBreakdown, FeeCorridor, ContractError};
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation},
    token, Address, Env, IntoVal, Symbol, String,
};

fn create_token_contract<'a>(env: &Env, admin: &Address) -> (token::Client<'a>, token::StellarAssetClient<'a>) {
    let contract_address = env.register_stellar_asset_contract(admin.clone());
    (
        token::Client::new(env, &contract_address),
        token::StellarAssetClient::new(env, &contract_address),
    )
}

// ============================================================================
// PERCENTAGE STRATEGY TESTS
// ============================================================================

#[test]
fn test_fee_breakdown_percentage_strategy_basic() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);
    client.register_agent(&agent);

    // Test percentage strategy: 2.5%
    let amount = 10000i128;
    let breakdown = client.get_fee_breakdown(&amount, &None, &None);

    // Platform fee: 10000 * 250 / 10000 = 250
    // Protocol fee: 0 (no protocol fee set)
    // Net amount: 10000 - 250 - 0 = 9750
    assert_eq!(breakdown.amount, 10000);
    assert_eq!(breakdown.platform_fee, 250);
    assert_eq!(breakdown.protocol_fee, 0);
    assert_eq!(breakdown.net_amount, 9750);
    assert_eq!(breakdown.corridor, None);
}

#[test]
fn test_fee_breakdown_percentage_different_amounts() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &1000000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    // Set 5% fee
    client.initialize(&admin, &token.address, &500, &0, &0, &treasury);
    client.register_agent(&agent);

    // Small amount
    let breakdown_small = client.get_fee_breakdown(&1000i128, &None, &None);
    assert_eq!(breakdown_small.amount, 1000);
    assert_eq!(breakdown_small.platform_fee, 50); // 5% of 1000
    assert_eq!(breakdown_small.net_amount, 950);

    // Medium amount
    let breakdown_medium = client.get_fee_breakdown(&5000i128, &None, &None);
    assert_eq!(breakdown_medium.amount, 5000);
    assert_eq!(breakdown_medium.platform_fee, 250); // 5% of 5000
    assert_eq!(breakdown_medium.net_amount, 4750);

    // Large amount
    let breakdown_large = client.get_fee_breakdown(&100000i128, &None, &None);
    assert_eq!(breakdown_large.amount, 100000);
    assert_eq!(breakdown_large.platform_fee, 5000); // 5% of 100000
    assert_eq!(breakdown_large.net_amount, 95000);
}

#[test]
fn test_fee_breakdown_percentage_with_protocol_fee() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    // Set platform fee: 2.5%, protocol fee: 0.5%
    client.initialize(&admin, &token.address, &250, &0, &50, &treasury);
    client.register_agent(&agent);

    let amount = 10000i128;
    let breakdown = client.get_fee_breakdown(&amount, &None, &None);

    // Platform fee: 10000 * 250 / 10000 = 250
    // Protocol fee: 10000 * 50 / 10000 = 50
    // Net amount: 10000 - 250 - 50 = 9700
    assert_eq!(breakdown.amount, 10000);
    assert_eq!(breakdown.platform_fee, 250);
    assert_eq!(breakdown.protocol_fee, 50);
    assert_eq!(breakdown.net_amount, 9700);
}

// ============================================================================
// FLAT STRATEGY TESTS
// ============================================================================

#[test]
fn test_fee_breakdown_flat_strategy() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);

    // Set flat fee: 100 units
    client.update_fee_strategy(&admin, &FeeStrategy::Flat(100));
    client.register_agent(&agent);

    // Small amount
    let breakdown_small = client.get_fee_breakdown(&1000i128, &None, &None);
    assert_eq!(breakdown_small.amount, 1000);
    assert_eq!(breakdown_small.platform_fee, 100);
    assert_eq!(breakdown_small.net_amount, 900);

    // Large amount - same fee
    let breakdown_large = client.get_fee_breakdown(&50000i128, &None, &None);
    assert_eq!(breakdown_large.amount, 50000);
    assert_eq!(breakdown_large.platform_fee, 100);
    assert_eq!(breakdown_large.net_amount, 49900);
}

#[test]
fn test_fee_breakdown_flat_strategy_with_protocol_fee() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    // Flat fee: 100, Protocol fee: 1%
    client.initialize(&admin, &token.address, &250, &0, &100, &treasury);
    client.update_fee_strategy(&admin, &FeeStrategy::Flat(100));
    client.register_agent(&agent);

    let amount = 10000i128;
    let breakdown = client.get_fee_breakdown(&amount, &None, &None);

    // Platform fee: 100 (flat)
    // Protocol fee: 10000 * 100 / 10000 = 100
    // Net amount: 10000 - 100 - 100 = 9800
    assert_eq!(breakdown.amount, 10000);
    assert_eq!(breakdown.platform_fee, 100);
    assert_eq!(breakdown.protocol_fee, 100);
    assert_eq!(breakdown.net_amount, 9800);
}

// ============================================================================
// DYNAMIC STRATEGY TESTS
// ============================================================================

#[test]
fn test_fee_breakdown_dynamic_tier1() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);

    // Set dynamic strategy: 4% base
    client.update_fee_strategy(&admin, &FeeStrategy::Dynamic(400));
    client.register_agent(&agent);

    // Tier 1: < 1000 -> 4%
    let amount = 500_0000000i128;
    let breakdown = client.get_fee_breakdown(&amount, &None, &None);

    // Fee: 500 * 400 / 10000 = 20
    assert_eq!(breakdown.amount, 500_0000000);
    assert_eq!(breakdown.platform_fee, 20_0000000);
    assert_eq!(breakdown.net_amount, 480_0000000);
}

#[test]
fn test_fee_breakdown_dynamic_tier2() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &1000000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);

    // Set dynamic strategy: 4% base
    client.update_fee_strategy(&admin, &FeeStrategy::Dynamic(400));
    client.register_agent(&agent);

    // Tier 2: 1000-10000 -> 80% of 4% = 3.2%
    let amount = 5000_0000000i128;
    let breakdown = client.get_fee_breakdown(&amount, &None, &None);

    // Fee: 5000 * (400 * 0.8) / 10000 = 5000 * 320 / 10000 = 160
    assert_eq!(breakdown.amount, 5000_0000000);
    assert_eq!(breakdown.platform_fee, 160_0000000);
    assert_eq!(breakdown.net_amount, 4840_0000000);
}

#[test]
fn test_fee_breakdown_dynamic_tier3() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &10000000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);

    // Set dynamic strategy: 4% base
    client.update_fee_strategy(&admin, &FeeStrategy::Dynamic(400));
    client.register_agent(&agent);

    // Tier 3: > 10000 -> 60% of 4% = 2.4%
    let amount = 20000_0000000i128;
    let breakdown = client.get_fee_breakdown(&amount, &None, &None);

    // Fee: 20000 * (400 * 0.6) / 10000 = 20000 * 240 / 10000 = 480
    assert_eq!(breakdown.amount, 20000_0000000);
    assert_eq!(breakdown.platform_fee, 480_0000000);
    assert_eq!(breakdown.net_amount, 19520_0000000);
}

// ============================================================================
// CORRIDOR TESTS
// ============================================================================

#[test]
fn test_fee_breakdown_with_corridor_identifier() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);
    client.register_agent(&agent);

    let from_country = String::from_str(&env, "US");
    let to_country = String::from_str(&env, "MX");
    let amount = 10000i128;

    let breakdown = client.get_fee_breakdown(&amount, &Some(from_country.clone()), &Some(to_country.clone()));

    // Should populate corridor field even without corridor config
    assert_eq!(breakdown.amount, 10000);
    assert_eq!(breakdown.platform_fee, 250);
    assert_eq!(breakdown.net_amount, 9750);
    assert!(breakdown.corridor.is_some());
}

#[test]
fn test_fee_breakdown_without_countries() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);
    client.register_agent(&agent);

    let amount = 10000i128;
    let breakdown = client.get_fee_breakdown(&amount, &None, &None);

    // Should not have corridor field
    assert_eq!(breakdown.corridor, None);
}

#[test]
fn test_fee_breakdown_partial_corridor_info() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);
    client.register_agent(&agent);

    let from_country = String::from_str(&env, "US");
    let amount = 10000i128;

    // Only from_country, no to_country
    let breakdown = client.get_fee_breakdown(&amount, &Some(from_country.clone()), &None);
    assert_eq!(breakdown.corridor, None);

    // Only to_country, no from_country
    let to_country = String::from_str(&env, "MX");
    let breakdown2 = client.get_fee_breakdown(&amount, &None, &Some(to_country.clone()));
    assert_eq!(breakdown2.corridor, None);
}

// ============================================================================
// ERROR CASES
// ============================================================================

#[test]
#[should_panic(expected = "Contract Error")]
fn test_fee_breakdown_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);
    client.register_agent(&agent);

    // Should panic on zero amount
    client.get_fee_breakdown(&0i128, &None, &None);
}

#[test]
#[should_panic(expected = "Contract Error")]
fn test_fee_breakdown_negative_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);
    client.register_agent(&agent);

    // Should panic on negative amount
    client.get_fee_breakdown(&-1000i128, &None, &None);
}

// ============================================================================
// EDGE CASES
// ============================================================================

#[test]
fn test_fee_breakdown_very_small_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);
    client.register_agent(&agent);

    // Minimum amount: 1
    let breakdown = client.get_fee_breakdown(&1i128, &None, &None);
    assert_eq!(breakdown.amount, 1);
    // Fee: 1 * 250 / 10000 = 0 (rounds down)
    assert_eq!(breakdown.platform_fee, 0);
    assert_eq!(breakdown.net_amount, 1);
}

#[test]
fn test_fee_breakdown_very_large_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &i128::MAX / 2);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);
    client.register_agent(&agent);

    // Very large amount
    let large_amount = 1_000_000_000_000_000i128;
    let breakdown = client.get_fee_breakdown(&large_amount, &None, &None);

    assert_eq!(breakdown.amount, large_amount);
    // Fee: 1_000_000_000_000_000 * 250 / 10000 = 25_000_000_000_000
    assert_eq!(breakdown.platform_fee, 25_000_000_000_000i128);
}

// ============================================================================
// VALIDATION TESTS
// ============================================================================

#[test]
fn test_fee_breakdown_consistency() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &1000000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &50, &treasury);
    client.register_agent(&agent);

    let amount = 10000i128;
    let breakdown = client.get_fee_breakdown(&amount, &None, &None);

    // Verify the mathematical relationship
    // amount = platform_fee + protocol_fee + net_amount
    let total = breakdown.platform_fee + breakdown.protocol_fee + breakdown.net_amount;
    assert_eq!(total, breakdown.amount);
}

#[test]
fn test_fee_breakdown_multiple_calls_consistent() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &200000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);
    client.register_agent(&agent);

    let amount = 10000i128;

    // Call multiple times - should get same result
    let breakdown1 = client.get_fee_breakdown(&amount, &None, &None);
    let breakdown2 = client.get_fee_breakdown(&amount, &None, &None);
    let breakdown3 = client.get_fee_breakdown(&amount, &None, &None);

    assert_eq!(breakdown1, breakdown2);
    assert_eq!(breakdown2, breakdown3);
}
