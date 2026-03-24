//! Property-based tests for SwiftRemit contract invariants.
//!
//! These tests validate critical invariants across randomized inputs:
//! - No balance creation (conservation of funds)
//! - No negative settlements
//! - Deterministic results (order independence)
//! - Fee calculation correctness
//! - State transition validity
#![cfg(test)]
extern crate std;

use crate::{SwiftRemitContract, SwiftRemitContractClient};
use proptest::prelude::*;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env, Vec as SorobanVec};

// ============================================================================
// Test Helpers
// ============================================================================

fn create_token_contract<'a>(env: &'a Env, admin: &Address) -> token::StellarAssetClient<'a> {
    let address = env.register_stellar_asset_contract_v2(admin.clone()).address();
    token::StellarAssetClient::new(env, &address)
}

fn create_swiftremit_contract<'a>(env: &'a Env) -> SwiftRemitContractClient<'a> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

// ============================================================================
// Property Test Strategies
// ============================================================================

/// Strategy for generating valid remittance amounts (1 to 1_000_000)
fn amount_strategy() -> impl Strategy<Value = i128> {
    1i128..=1_000_000i128
}

/// Strategy for generating valid fee basis points (0 to 1000 = 0% to 10%)
fn fee_bps_strategy() -> impl Strategy<Value = u32> {
    0u32..=1000u32
}

/// Strategy for generating number of remittances in a batch (1 to 20)
fn batch_size_strategy() -> impl Strategy<Value = usize> {
    1usize..=20usize
}

// ============================================================================
// Invariant 1: No Balance Creation
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]
    
    /// Property: Total balance in the system must be conserved.
    /// 
    /// For any remittance operation:
    /// - Initial total balance = sender_balance + contract_balance
    /// - After create_remittance: total balance unchanged
    /// - After confirm_payout: total balance unchanged (only redistributed)
    /// - After cancel: total balance unchanged
    #[test]
    fn prop_no_balance_creation_on_create(
        amount in amount_strategy(),
        fee_bps in fee_bps_strategy()
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = create_token_contract(&env, &token_admin);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        // Setup
        let initial_mint = 10_000_000i128;
        token.mint(&sender, &initial_mint);

        let contract = create_swiftremit_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        let token_client = token::Client::new(&env, &token.address);

        // Record initial total balance
        let initial_total = token_client.balance(&sender) 
            + token_client.balance(&contract.address)
            + token_client.balance(&agent);

        // Create remittance
        let _remittance_id = contract.create_remittance(
            &sender,
            &agent,
            &amount,
            &None
        );

        // Verify total balance unchanged
        let after_create_total = token_client.balance(&sender)
            + token_client.balance(&contract.address)
            + token_client.balance(&agent);

        prop_assert_eq!(initial_total, after_create_total, 
            "Balance created during remittance creation");
    }

    #[test]
    fn prop_no_balance_creation_on_settlement(
        amount in amount_strategy(),
        fee_bps in fee_bps_strategy()
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = create_token_contract(&env, &token_admin);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        // Setup
        let initial_mint = 10_000_000i128;
        token.mint(&sender, &initial_mint);

        let contract = create_swiftremit_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        let token_client = token::Client::new(&env, &token.address);

        // Create remittance
        let remittance_id = contract.create_remittance(
            &sender,
            &agent,
            &amount,
            &None
        );

        // Record balance before settlement
        let before_settle_total = token_client.balance(&sender)
            + token_client.balance(&contract.address)
            + token_client.balance(&agent)
            + token_client.balance(&admin); // treasury

        // Settle remittance
        contract.confirm_payout(&remittance_id);

        // Verify total balance unchanged
        let after_settle_total = token_client.balance(&sender)
            + token_client.balance(&contract.address)
            + token_client.balance(&agent)
            + token_client.balance(&admin); // treasury

        prop_assert_eq!(before_settle_total, after_settle_total,
            "Balance created during settlement");
    }

    #[test]
    fn prop_no_balance_creation_on_cancel(
        amount in amount_strategy(),
        fee_bps in fee_bps_strategy()
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = create_token_contract(&env, &token_admin);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        // Setup
        let initial_mint = 10_000_000i128;
        token.mint(&sender, &initial_mint);

        let contract = create_swiftremit_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);

        let token_client = token::Client::new(&env, &token.address);

        // Create remittance
        let remittance_id = contract.create_remittance(
            &sender,
            &agent,
            &amount,
            &None
        );

        // Record balance before cancel
        let before_cancel_total = token_client.balance(&sender)
            + token_client.balance(&contract.address)
            + token_client.balance(&agent);

        // Cancel remittance
        contract.cancel_remittance(&remittance_id);

        // Verify total balance unchanged
        let after_cancel_total = token_client.balance(&sender)
            + token_client.balance(&contract.address)
            + token_client.balance(&agent);

        prop_assert_eq!(before_cancel_total, after_cancel_total,
            "Balance created during cancellation");
    }
}

// ============================================================================
// Invariant 2: No Negative Settlements
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]
    
    /// Property: All balances must remain non-negative after any operation.
    #[test]
    fn prop_no_negative_balances(
        amount in amount_strategy(),
        fee_bps in fee_bps_strategy()
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = create_token_contract(&env, &token_admin);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        // Setup with sufficient balance
        let initial_mint = amount * 2;
        token.mint(&sender, &initial_mint);

        let contract = create_swiftremit_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        let token_client = token::Client::new(&env, &token.address);

        // Create and settle remittance
        let remittance_id = contract.create_remittance(
            &sender,
            &agent,
            &amount,
            &None
        );

        contract.confirm_payout(&remittance_id);

        // Verify all balances are non-negative
        prop_assert!(token_client.balance(&sender) >= 0, 
            "Sender balance became negative");
        prop_assert!(token_client.balance(&agent) >= 0,
            "Agent balance became negative");
        prop_assert!(token_client.balance(&contract.address) >= 0,
            "Contract balance became negative");
    }

    #[test]
    fn prop_payout_amount_non_negative(
        amount in amount_strategy(),
        fee_bps in fee_bps_strategy()
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = create_token_contract(&env, &token_admin);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        token.mint(&sender, &(amount * 2));

        let contract = create_swiftremit_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        let remittance_id = contract.create_remittance(
            &sender,
            &agent,
            &amount,
            &None
        );

        let remittance = contract.get_remittance(&remittance_id);
        
        // Calculate expected payout
        let payout = amount - remittance.fee;
        
        prop_assert!(payout >= 0, "Payout amount is negative");
        prop_assert!(remittance.fee >= 0, "Fee is negative");
        prop_assert!(remittance.fee <= amount, "Fee exceeds amount");
    }
}

// ============================================================================
// Invariant 3: Deterministic Results (Order Independence)
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]
    
    /// Property: Net settlement results must be independent of input order.
    #[test]
    fn prop_netting_order_independence(
        amounts in prop::collection::vec(amount_strategy(), 2..=10)
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = create_token_contract(&env, &token_admin);
        
        // Create two parties for bidirectional flows
        let party_a = Address::generate(&env);
        let party_b = Address::generate(&env);

        let total_needed: i128 = amounts.iter().sum::<i128>() * 2;
        token.mint(&party_a, &total_needed);
        token.mint(&party_b, &total_needed);

        let contract = create_swiftremit_contract(&env);
        contract.initialize(&admin, &token.address, &250, &0, &0, &admin);
        contract.register_agent(&party_a);
        contract.register_agent(&party_b);

        // Create remittances in original order
        let mut remittances_forward = SorobanVec::new(&env);
        for (i, &amount) in amounts.iter().enumerate() {
            let (sender, agent) = if i % 2 == 0 {
                (&party_a, &party_b)
            } else {
                (&party_b, &party_a)
            };

            let remittance_id = contract.create_remittance(
                sender,
                agent,
                &amount,
                &None
            );
            
            let remittance = contract.get_remittance(&remittance_id);
            remittances_forward.push_back(remittance);
        }

        // Create remittances in reverse order
        let mut remittances_reverse = SorobanVec::new(&env);
        for (i, &amount) in amounts.iter().rev().enumerate() {
            let (sender, agent) = if (amounts.len() - 1 - i) % 2 == 0 {
                (&party_a, &party_b)
            } else {
                (&party_b, &party_a)
            };

            let remittance_id = contract.create_remittance(
                sender,
                agent,
                &amount,
                &None
            );
            
            let remittance = contract.get_remittance(&remittance_id);
            remittances_reverse.push_back(remittance);
        }

        // Compute net settlements for both orders
        let net_forward = crate::netting::compute_net_settlements(&env, &remittances_forward);
        let net_reverse = crate::netting::compute_net_settlements(&env, &remittances_reverse);

        // Results should be identical
        prop_assert_eq!(net_forward.len(), net_reverse.len(),
            "Different number of net transfers");

        if net_forward.len() > 0 {
            let transfer_forward = net_forward.get_unchecked(0);
            let transfer_reverse = net_reverse.get_unchecked(0);

            prop_assert_eq!(transfer_forward.net_amount.abs(), transfer_reverse.net_amount.abs(),
                "Net amounts differ between orderings");
            prop_assert_eq!(transfer_forward.total_fees, transfer_reverse.total_fees,
                "Total fees differ between orderings");
        }
    }
}

// ============================================================================
// Invariant 4: Fee Calculation Correctness
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]
    
    /// Property: Fees must be calculated correctly and consistently.
    #[test]
    fn prop_fee_calculation_accuracy(
        amount in amount_strategy(),
        fee_bps in fee_bps_strategy()
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = create_token_contract(&env, &token_admin);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        token.mint(&sender, &(amount * 2));

        let contract = create_swiftremit_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);

        let remittance_id = contract.create_remittance(
            &sender,
            &agent,
            &amount,
            &None
        );

        let remittance = contract.get_remittance(&remittance_id);

        // Calculate expected fee
        let expected_fee = (amount * fee_bps as i128) / 10000;

        prop_assert_eq!(remittance.fee, expected_fee,
            "Fee calculation incorrect");
        
        // Verify fee is within valid range
        prop_assert!(remittance.fee >= 0, "Fee is negative");
        prop_assert!(remittance.fee <= amount, "Fee exceeds amount");
        
        // Verify payout + fee = amount
        let payout = amount - remittance.fee;
        prop_assert_eq!(payout + remittance.fee, amount,
            "Payout + fee != amount");
    }

    #[test]
    fn prop_accumulated_fees_correctness(
        amounts in prop::collection::vec(amount_strategy(), 1..=10),
        fee_bps in fee_bps_strategy()
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = create_token_contract(&env, &token_admin);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let total_amount: i128 = amounts.iter().sum::<i128>() * 2;
        token.mint(&sender, &total_amount);

        let contract = create_swiftremit_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        let mut expected_total_fees = 0i128;

        // Create and settle multiple remittances
        for &amount in &amounts {
            let remittance_id = contract.create_remittance(
                &sender,
                &agent,
                &amount,
                &None
            );

            let remittance = contract.get_remittance(&remittance_id);
            expected_total_fees += remittance.fee;

            contract.confirm_payout(&remittance_id);
        }

        let accumulated_fees = contract.get_accumulated_fees();

        prop_assert_eq!(accumulated_fees, expected_total_fees,
            "Accumulated fees don't match sum of individual fees");
    }
}

// ============================================================================
// Invariant 5: State Transition Validity
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]
    
    /// Property: Remittance status transitions must follow valid state machine.
    #[test]
    fn prop_valid_state_transitions(
        amount in amount_strategy(),
        fee_bps in fee_bps_strategy()
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = create_token_contract(&env, &token_admin);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        token.mint(&sender, &(amount * 2));

        let contract = create_swiftremit_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        // Create remittance - should start in Pending
        let remittance_id = contract.create_remittance(
            &sender,
            &agent,
            &amount,
            &None
        );

        let remittance = contract.get_remittance(&remittance_id);
        prop_assert_eq!(remittance.status, crate::RemittanceStatus::Pending,
            "New remittance not in Pending state");

        // Settle remittance - should transition to Settled
        contract.confirm_payout(&remittance_id);

        let remittance = contract.get_remittance(&remittance_id);
        prop_assert_eq!(remittance.status, crate::RemittanceStatus::Completed,
            "Settled remittance not in Settled state");
    }

    #[test]
    fn prop_cancel_state_transition(
        amount in amount_strategy(),
        fee_bps in fee_bps_strategy()
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = create_token_contract(&env, &token_admin);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        token.mint(&sender, &(amount * 2));

        let contract = create_swiftremit_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);

        // Create remittance
        let remittance_id = contract.create_remittance(
            &sender,
            &agent,
            &amount,
            &None
        );

        // Cancel remittance - should transition to Failed
        contract.cancel_remittance(&remittance_id);

        let remittance = contract.get_remittance(&remittance_id);
        prop_assert_eq!(remittance.status, crate::RemittanceStatus::Cancelled,
            "Cancelled remittance not in Failed state");
    }
}

// ============================================================================
// Invariant 6: Idempotency and Duplicate Prevention
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]
    
    /// Property: Duplicate settlement attempts must be prevented.
    #[test]
    fn prop_no_duplicate_settlement(
        amount in amount_strategy(),
        fee_bps in fee_bps_strategy()
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = create_token_contract(&env, &token_admin);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        token.mint(&sender, &(amount * 2));

        let contract = create_swiftremit_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        let token_client = token::Client::new(&env, &token.address);

        // Create and settle remittance
        let remittance_id = contract.create_remittance(
            &sender,
            &agent,
            &amount,
            &None
        );

        contract.confirm_payout(&remittance_id);

        let agent_balance_after_first = token_client.balance(&agent);

        // Attempt duplicate settlement - should fail
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.confirm_payout(&remittance_id);
        }));

        prop_assert!(result.is_err(), "Duplicate settlement was not prevented");

        // Verify agent balance unchanged
        let agent_balance_after_second = token_client.balance(&agent);
        prop_assert_eq!(agent_balance_after_first, agent_balance_after_second,
            "Agent balance changed on duplicate settlement attempt");
    }
}

// ============================================================================
// Invariant 7: Net Settlement Conservation
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]
    
    /// Property: Net settlement must preserve total fees.
    #[test]
    fn prop_netting_preserves_fees(
        amounts in prop::collection::vec(amount_strategy(), 2..=8)
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = create_token_contract(&env, &token_admin);
        
        let party_a = Address::generate(&env);
        let party_b = Address::generate(&env);

        let total_needed: i128 = amounts.iter().sum::<i128>() * 2;
        token.mint(&party_a, &total_needed);
        token.mint(&party_b, &total_needed);

        let contract = create_swiftremit_contract(&env);
        contract.initialize(&admin, &token.address, &250, &0, &0, &admin);
        contract.register_agent(&party_a);
        contract.register_agent(&party_b);

        let mut remittances = SorobanVec::new(&env);
        let mut expected_total_fees = 0i128;

        // Create alternating remittances between parties
        for (i, &amount) in amounts.iter().enumerate() {
            let (sender, agent) = if i % 2 == 0 {
                (&party_a, &party_b)
            } else {
                (&party_b, &party_a)
            };

            let remittance_id = contract.create_remittance(
                sender,
                agent,
                &amount,
                &None
            );
            
            let remittance = contract.get_remittance(&remittance_id);
            expected_total_fees += remittance.fee;
            remittances.push_back(remittance);
        }

        // Compute net settlements
        let net_transfers = crate::netting::compute_net_settlements(&env, &remittances);

        // Sum fees from net transfers
        let mut net_total_fees = 0i128;
        for i in 0..net_transfers.len() {
            let transfer = net_transfers.get_unchecked(i);
            net_total_fees += transfer.total_fees;
        }

        prop_assert_eq!(net_total_fees, expected_total_fees,
            "Net settlement did not preserve total fees");
    }
}


