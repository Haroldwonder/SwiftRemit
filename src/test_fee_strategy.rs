#![cfg(test)]

use crate::{SwiftRemitContract, SwiftRemitContractClient, FeeStrategy};
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, LedgerInfo},
    token, Address, Env, IntoVal, Symbol,
};

fn create_token_contract<'a>(env: &Env, admin: &Address) -> (token::Client<'a>, token::StellarAssetClient<'a>) {
    let contract_address = env.register_stellar_asset_contract(admin.clone());
    (
        token::Client::new(env, &contract_address),
        token::StellarAssetClient::new(env, &contract_address),
    )
}

#[test]
fn test_percentage_strategy() {
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

    // Set percentage strategy: 5%
    client.update_fee_strategy(&admin, &FeeStrategy::Percentage(500));

    client.register_agent(&agent);

    let remittance_id = client.create_remittance(&sender, &agent, &10000, &None, &None, &None);
    let remittance = client.get_remittance(&remittance_id);

    // Fee should be 5% of 10000 = 500
    assert_eq!(remittance.fee, 500);
}

#[test]
fn test_sender_volume_discount_applies_after_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100_000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &500, &0, &0, &treasury);
    client.register_agent(&agent);

    // First remittance stays below the rolling threshold and pays the base fee.
    let id1 = client.create_remittance(&sender, &agent, &9_000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id1).fee, 450);

    // Second remittance pushes rolling volume over 10k; fee should drop to 1.5% (150 bps).
    let id2 = client.create_remittance(&sender, &agent, &2_000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id2).fee, 30);
}

#[test]
fn test_sender_volume_discount_rolls_off_after_30_days() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100_000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &500, &0, &0, &treasury);
    client.register_agent(&agent);

    let id1 = client.create_remittance(&sender, &agent, &9_000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id1).fee, 450);

    // Advance ledger 31 days so the first volume falls out of the rolling window.
    env.ledger().set(LedgerInfo {
        timestamp: env.ledger().timestamp() + 31 * 24 * 60 * 60,
        ..env.ledger().get()
    });

    let id2 = client.create_remittance(&sender, &agent, &9_000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id2).fee, 450);
}

#[test]
fn test_batch_remittances_apply_cumulative_sender_volume_discount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100_000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &500, &0, &0, &treasury);
    client.register_agent(&agent);

    let entries = vec![
        crate::BatchCreateEntry {
            agent: agent.clone(),
            amount: 7_000,
            expiry: None,
        },
        crate::BatchCreateEntry {
            agent: agent.clone(),
            amount: 7_000,
            expiry: None,
        },
    ];

    let remittance_ids = client.batch_create_remittances(&sender, &entries);
    assert_eq!(remittance_ids.len(), 2);

    let fee1 = client.get_remittance(&remittance_ids.get_unchecked(0)).fee;
    let fee2 = client.get_remittance(&remittance_ids.get_unchecked(1)).fee;

    assert_eq!(fee1, 175); // 7k * 2.5% = 175
    assert_eq!(fee2, 105); // discounted 7k * 1.5% = 105
}

#[test]
fn test_flat_strategy() {
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
    let id1 = client.create_remittance(&sender, &agent, &1000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id1).fee, 100);

    // Large amount - same fee
    let id2 = client.create_remittance(&sender, &agent, &50000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id2).fee, 100);
}

#[test]
fn test_dynamic_strategy() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &1_000_000_000_000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);

    // Set dynamic strategy: 4% base
    client.update_fee_strategy(&admin, &FeeStrategy::Dynamic(400));

    client.register_agent(&agent);

    // Tier 1: amount < 1_000_0000000 -> full 4%
    let id1 = client.create_remittance(&sender, &agent, &5_000_000_000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id1).fee, 200_000_000);

    // Tier 2: 1_000_0000000 <= amount < 10_000_0000000 -> 80% of base = 3.2%
    let id2 = client.create_remittance(&sender, &agent, &50_000_000_000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id2).fee, 1_600_000_000);

    // Tier 3: amount >= 10_000_0000000 -> 60% of base = 2.4%
    let id3 = client.create_remittance(&sender, &agent, &200_000_000_000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id3).fee, 4_800_000_000);
}

#[test]
fn test_strategy_switch_without_redeployment() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &1_000_000_000_000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);
    client.register_agent(&agent);

    // Start with percentage
    client.update_fee_strategy(&admin, &FeeStrategy::Percentage(250));
    let id1 = client.create_remittance(&sender, &agent, &10000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id1).fee, 250);

    // Switch to flat
    client.update_fee_strategy(&admin, &FeeStrategy::Flat(150));
    let id2 = client.create_remittance(&sender, &agent, &10000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id2).fee, 150);

    // Switch to dynamic: Tier 3 (>= 10_000_0000000) -> 60% of 4% = 2.4%
    client.update_fee_strategy(&admin, &FeeStrategy::Dynamic(400));
    let id3 = client.create_remittance(&sender, &agent, &200_000_000_000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id3).fee, 4_800_000_000);
}

#[test]
fn test_get_fee_strategy() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, _) = create_token_contract(&env, &admin);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);

    // Default should be Percentage(250)
    let strategy = client.get_fee_strategy();
    assert_eq!(strategy, FeeStrategy::Percentage(250));

    // Update and verify
    client.update_fee_strategy(&admin, &FeeStrategy::Flat(200));
    assert_eq!(client.get_fee_strategy(), FeeStrategy::Flat(200));
}

#[test]
fn test_backwards_compatibility() {
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

    // Initialize with old fee_bps parameter (250 = 2.5%)
    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);
    client.register_agent(&agent);

    // Should default to Percentage strategy with 2.5%
    let id = client.create_remittance(&sender, &agent, &10000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id).fee, 250);

    // Old update_fee should still work (updates percentage strategy)
    client.update_fee(&500); // 5%

    // Verify strategy updated to new percentage
    let strategy = client.get_fee_strategy();
    assert_eq!(strategy, FeeStrategy::Percentage(500));
}

// ============================================================================
// Property-based tests for fee calculation edge cases
// ============================================================================

#[cfg(test)]
mod property_tests {
    use crate::fee_service::calculate_fees_with_breakdown;
    use crate::FeeStrategy;
    use proptest::prelude::*;
    use soroban_sdk::Env;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        /// Property 1: fee is always >= 0 for all valid amounts and all three strategies.
        #[test]
        fn prop_fee_never_negative(
            amount in 1i128..=10_000_000_000i128,
            fee_bps in 0u32..=10000u32,
            flat_fee in 0i128..=1_000_000i128,
            dynamic_bps in 0u32..=10000u32,
        ) {
            let env = Env::default();
            for strategy in &[
                FeeStrategy::Percentage(fee_bps),
                FeeStrategy::Flat(flat_fee),
                FeeStrategy::Dynamic(dynamic_bps),
            ] {
                crate::storage::set_fee_strategy(&env, strategy);
                let b = calculate_fees_with_breakdown(&env, amount, None).unwrap();
                prop_assert!(b.platform_fee >= 0, "platform_fee < 0: strategy={:?} amount={}", strategy, amount);
                prop_assert!(b.net_amount >= 0, "net_amount < 0: strategy={:?} amount={}", strategy, amount);
            }
        }

        /// Property 2: net_amount + platform_fee + protocol_fee == amount always holds.
        #[test]
        fn prop_fee_breakdown_sums_to_amount(
            amount in 1i128..=10_000_000_000i128,
            fee_bps in 0u32..=10000u32,
            // MAX_PROTOCOL_FEE_BPS = 200
            protocol_fee_bps in 0u32..=200u32,
        ) {
            let env = Env::default();
            crate::storage::set_fee_strategy(&env, &FeeStrategy::Percentage(fee_bps));
            crate::storage::set_protocol_fee_bps(&env, protocol_fee_bps).unwrap();

            let b = calculate_fees_with_breakdown(&env, amount, None).unwrap();

            prop_assert_eq!(
                b.net_amount + b.platform_fee + b.protocol_fee,
                b.amount,
                "breakdown does not sum to amount: amount={} fee_bps={} protocol_fee_bps={}",
                amount, fee_bps, protocol_fee_bps
            );
            prop_assert!(b.validate().is_ok(), "FeeBreakdown::validate() failed for amount={}", amount);
        }

        /// Property 3: Dynamic fee tiers are monotonically non-increasing per unit
        /// (effective rate in Tier1 >= Tier2 >= Tier3).
        #[test]
        fn prop_dynamic_fee_tiers_monotonically_non_increasing(
            base_bps in 1u32..=10000u32,
        ) {
            let env = Env::default();
            crate::storage::set_fee_strategy(&env, &FeeStrategy::Dynamic(base_bps));

            // Representative amounts: one per tier (thresholds are in stroops: 1_000_0000000 and 10_000_0000000)
            let tier1 = 500_0000000i128;        // < 1_000_0000000  → full rate
            let tier2 = 5_000_0000000i128;      // 1000–10000 range → 80% of base
            let tier3 = 50_000_0000000i128;     // > 10_000_0000000 → 60% of base

            let b1 = calculate_fees_with_breakdown(&env, tier1, None).unwrap();
            let b2 = calculate_fees_with_breakdown(&env, tier2, None).unwrap();
            let b3 = calculate_fees_with_breakdown(&env, tier3, None).unwrap();

            // Effective rate in bps = platform_fee * 10000 / amount
            let rate1 = b1.platform_fee * 10000 / tier1;
            let rate2 = b2.platform_fee * 10000 / tier2;
            let rate3 = b3.platform_fee * 10000 / tier3;

            prop_assert!(rate1 >= rate2,
                "Tier1 rate ({}) should be >= Tier2 rate ({}) for base_bps={}", rate1, rate2, base_bps);
            prop_assert!(rate2 >= rate3,
                "Tier2 rate ({}) should be >= Tier3 rate ({}) for base_bps={}", rate2, rate3, base_bps);
        }
    }
}

#[test]
fn test_corridor_strategy_hot_swap() {
    // Issue #423: FeeStrategy::Corridor can be set without a contract upgrade.
    // When no corridor config exists for the pair, it falls back to the platform fee bps.
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (token, token_admin) = create_token_contract(&env, &admin);
    token_admin.mint(&sender, &100_000);

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    // Initialize with 2.5% fee
    client.initialize(&admin, &token.address, &250, &0, &0, &treasury);
    client.register_agent(&agent);

    // Hot-swap to Corridor strategy — no WASM upgrade needed
    client.update_fee_strategy(&admin, &FeeStrategy::Corridor);
    assert_eq!(client.get_fee_strategy(), FeeStrategy::Corridor);

    // Without a corridor config, falls back to platform fee bps (250 = 2.5%)
    let id = client.create_remittance(&sender, &agent, &10000, &None, &None, &None);
    assert_eq!(client.get_remittance(&id).fee, 250);
}
