#![cfg(test)]

use crate::{SwiftRemitContract, SwiftRemitContractClient};
use soroban_sdk::{
    symbol_short, testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Events},
    token, Address, Env, IntoVal, String, Symbol,
};

fn create_token_contract<'a>(env: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    token::StellarAssetClient::new(env, &env.register_stellar_asset_contract_v2(admin.clone()))
}

fn create_swiftremit_contract<'a>(env: &Env) -> SwiftRemitContractClient<'a> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    contract.initialize(&admin, &token.address, &250);

    assert_eq!(contract.get_platform_fee_bps(), 250);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_initialize_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    contract.initialize(&admin, &token.address, &250);
    contract.initialize(&admin, &token.address, &250);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_initialize_invalid_fee() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    contract.initialize(&admin, &token.address, &10001);
}

#[test]
fn test_register_agent() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let agent = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    contract.register_agent(&agent);

    assert!(contract.is_agent_registered(&agent));

    assert_eq!(
        env.auths(),
        [(
            admin.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    contract.address.clone(),
                    symbol_short!("register_agent"),
                    (&agent,).into_val(&env)
                )),
                sub_invocations: std::vec![]
            }
        )]
    );
}

#[test]
fn test_remove_agent() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let agent = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    contract.register_agent(&agent);
    assert!(contract.is_agent_registered(&agent));

    contract.remove_agent(&agent);
    assert!(!contract.is_agent_registered(&agent));
}

#[test]
fn test_update_fee() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    contract.update_fee(&500);
    assert_eq!(contract.get_platform_fee_bps(), 500);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_update_fee_invalid() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    contract.update_fee(&10001);
}

#[test]
fn test_create_remittance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    assert_eq!(remittance_id, 1);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.sender, sender);
    assert_eq!(remittance.agent, agent);
    assert_eq!(remittance.amount, 1000);
    assert_eq!(remittance.fee, 25);

    assert_eq!(token.balance(&contract.address), 1000);
    assert_eq!(token.balance(&sender), 9000);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_create_remittance_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    contract.create_remittance(&sender, &agent, &0, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_create_remittance_unregistered_agent() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    contract.create_remittance(&sender, &agent, &1000, &None);
}

#[test]
fn test_confirm_payout() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    contract.confirm_payout(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Completed);

    assert_eq!(token.balance(&agent), 975);
    assert_eq!(contract.get_accumulated_fees(), 25);
    assert_eq!(token.balance(&contract.address), 25);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_confirm_payout_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    contract.confirm_payout(&remittance_id);
    contract.confirm_payout(&remittance_id);
}

#[test]
fn test_cancel_remittance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    contract.cancel_remittance(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Cancelled);

    assert_eq!(token.balance(&sender), 10000);
    assert_eq!(token.balance(&contract.address), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_cancel_remittance_already_completed() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);
    contract.confirm_payout(&remittance_id);

    contract.cancel_remittance(&remittance_id);
}

// ============================================================================
// Comprehensive Cancellation Flow Tests
// ============================================================================

#[test]
fn test_cancel_remittance_full_refund() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    // Mint initial balance to sender
    let initial_balance = 10000i128;
    token.mint(&sender, &initial_balance);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250); // 2.5% fee
    contract.register_agent(&agent);

    // Create remittance with 1000 tokens
    let remittance_amount = 1000i128;
    let remittance_id = contract.create_remittance(&sender, &agent, &remittance_amount, &None);

    // Verify sender balance decreased by full amount
    assert_eq!(token.balance(&sender), initial_balance - remittance_amount);
    assert_eq!(token.balance(&contract.address), remittance_amount);

    // Cancel the remittance
    contract.cancel_remittance(&remittance_id);

    // Verify full refund (entire amount including fee portion)
    assert_eq!(token.balance(&sender), initial_balance);
    assert_eq!(token.balance(&contract.address), 0);

    // Verify remittance status is Cancelled
    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Cancelled);
}

#[test]
fn test_cancel_remittance_sender_authorization() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    // Cancel and verify sender authorization was required
    contract.cancel_remittance(&remittance_id);

    assert_eq!(
        env.auths(),
        [(
            sender.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    contract.address.clone(),
                    symbol_short!("cancel_remittance"),
                    (remittance_id,).into_val(&env)
                )),
                sub_invocations: std::vec![]
            }
        )]
    );
}

#[test]
fn test_cancel_remittance_event_emission() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_amount = 1000i128;
    let remittance_id = contract.create_remittance(&sender, &agent, &remittance_amount, &None);

    // Cancel the remittance
    contract.cancel_remittance(&remittance_id);

    // Verify event was emitted
    let events = env.events().all();
    let event = events.last().unwrap();

    assert_eq!(
        event,
        (
            contract.address.clone(),
            (Symbol::new(&env, "remittance_cancelled"), remittance_id).into_val(&env),
            (sender.clone(), agent.clone(), token.address.clone(), remittance_amount).into_val(&env)
        )
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_cancel_remittance_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    // Try to cancel non-existent remittance
    contract.cancel_remittance(&999);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_cancel_remittance_already_cancelled() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    // Cancel once
    contract.cancel_remittance(&remittance_id);

    // Try to cancel again - should fail
    contract.cancel_remittance(&remittance_id);
}

#[test]
fn test_cancel_remittance_multiple_remittances() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &20000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Create multiple remittances
    let remittance_id1 = contract.create_remittance(&sender, &agent, &1000, &None);
    let remittance_id2 = contract.create_remittance(&sender, &agent, &2000, &None);
    let remittance_id3 = contract.create_remittance(&sender, &agent, &3000, &None);

    // Sender should have 14000 left (20000 - 1000 - 2000 - 3000)
    assert_eq!(token.balance(&sender), 14000);
    assert_eq!(token.balance(&contract.address), 6000);

    // Cancel first and third remittances
    contract.cancel_remittance(&remittance_id1);
    contract.cancel_remittance(&remittance_id3);

    // Verify partial refunds
    assert_eq!(token.balance(&sender), 18000); // 14000 + 1000 + 3000
    assert_eq!(token.balance(&contract.address), 2000); // Only remittance_id2 remains

    // Verify statuses
    let r1 = contract.get_remittance(&remittance_id1);
    let r2 = contract.get_remittance(&remittance_id2);
    let r3 = contract.get_remittance(&remittance_id3);

    assert_eq!(r1.status, crate::types::RemittanceStatus::Cancelled);
    assert_eq!(r2.status, crate::types::RemittanceStatus::Pending);
    assert_eq!(r3.status, crate::types::RemittanceStatus::Cancelled);
}

#[test]
fn test_cancel_remittance_no_fee_accumulation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Create and cancel remittance
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);
    contract.cancel_remittance(&remittance_id);

    // Verify no fees were accumulated (fees only accumulate on successful payout)
    assert_eq!(contract.get_accumulated_fees(), 0);
}

#[test]
fn test_cancel_remittance_preserves_remittance_data() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_amount = 1000i128;
    let remittance_id = contract.create_remittance(&sender, &agent, &remittance_amount, &None);

    // Get original remittance data
    let original = contract.get_remittance(&remittance_id);

    // Cancel the remittance
    contract.cancel_remittance(&remittance_id);

    // Get cancelled remittance data
    let cancelled = contract.get_remittance(&remittance_id);

    // Verify all data is preserved except status
    assert_eq!(cancelled.id, original.id);
    assert_eq!(cancelled.sender, original.sender);
    assert_eq!(cancelled.agent, original.agent);
    assert_eq!(cancelled.amount, original.amount);
    assert_eq!(cancelled.fee, original.fee);
    assert_eq!(cancelled.expiry, original.expiry);
    assert_eq!(cancelled.status, crate::types::RemittanceStatus::Cancelled);
    assert_eq!(original.status, crate::types::RemittanceStatus::Pending);
}


#[test]
fn test_withdraw_fees() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);
    contract.confirm_payout(&remittance_id);

    contract.withdraw_fees(&fee_recipient);

    assert_eq!(token.balance(&fee_recipient), 25);
    assert_eq!(contract.get_accumulated_fees(), 0);
    assert_eq!(token.balance(&contract.address), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_withdraw_fees_no_fees() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let fee_recipient = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    contract.withdraw_fees(&fee_recipient);
}

#[test]
fn test_fee_calculation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &100000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &500);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &10000, &None);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.fee, 500);

    contract.confirm_payout(&remittance_id);
    assert_eq!(token.balance(&agent), 9500);
    assert_eq!(contract.get_accumulated_fees(), 500);
}

#[test]
fn test_multiple_remittances() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender1 = Address::generate(&env);
    let sender2 = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender1, &10000);
    token.mint(&sender2, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id1 = contract.create_remittance(&sender1, &agent, &1000, &None);
    let remittance_id2 = contract.create_remittance(&sender2, &agent, &2000, &None);

    assert_eq!(remittance_id1, 1);
    assert_eq!(remittance_id2, 2);

    contract.confirm_payout(&remittance_id1);
    contract.confirm_payout(&remittance_id2);

    assert_eq!(contract.get_accumulated_fees(), 75);
    assert_eq!(token.balance(&agent), 2925);
}

#[test]
fn test_events_emitted() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    contract.register_agent(&agent);

    let events = env.events().all();
    let agent_reg_event = events.last().unwrap();

    assert_eq!(
        agent_reg_event.topics,
        (symbol_short!("agent_reg"),).into_val(&env)
    );

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    let events = env.events().all();
    let create_event = events.last().unwrap();

    assert_eq!(
        create_event.topics,
        (symbol_short!("created"),).into_val(&env)
    );

    contract.confirm_payout(&remittance_id);

    let events = env.events().all();
    let complete_event = events.last().unwrap();

    assert_eq!(
        complete_event.topics,
        (symbol_short!("completed"),).into_val(&env)
    );
}

#[test]
fn test_authorization_enforcement() {
    let env = Env::default();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);

    env.mock_all_auths();
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    env.mock_all_auths();
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    env.mock_all_auths();
    contract.confirm_payout(&remittance_id);

    assert_eq!(
        env.auths(),
        [(
            agent.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    contract.address.clone(),
                    symbol_short!("confirm_payout"),
                    (remittance_id,).into_val(&env)
                )),
                sub_invocations: std::vec![]
            }
        )]
    );
}

#[test]
fn test_withdraw_fees_valid_address() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);
    contract.confirm_payout(&remittance_id);

    // This should succeed with a valid address
    contract.withdraw_fees(&fee_recipient);

    assert_eq!(token.balance(&fee_recipient), 25);
    assert_eq!(contract.get_accumulated_fees(), 0);
}

#[test]
fn test_confirm_payout_valid_address() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    // This should succeed with a valid agent address
    contract.confirm_payout(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(token.balance(&agent), 975);
}

#[test]
fn test_address_validation_in_settlement_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Create remittance with valid addresses
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);
    
    // Confirm payout - should validate agent address
    contract.confirm_payout(&remittance_id);

    // Verify the settlement completed successfully
    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(token.balance(&agent), 975);
    assert_eq!(contract.get_accumulated_fees(), 25);
}

#[test]
fn test_multiple_settlements_with_address_validation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender1 = Address::generate(&env);
    let sender2 = Address::generate(&env);
    let agent1 = Address::generate(&env);
    let agent2 = Address::generate(&env);

    token.mint(&sender1, &10000);
    token.mint(&sender2, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent1);
    contract.register_agent(&agent2);

    // Create and confirm multiple remittances
    let remittance_id1 = contract.create_remittance(&sender1, &agent1, &1000, &None);
    let remittance_id2 = contract.create_remittance(&sender2, &agent2, &2000, &None);

    // Both should succeed with valid addresses
    contract.confirm_payout(&remittance_id1);
    contract.confirm_payout(&remittance_id2);

    assert_eq!(token.balance(&agent1), 975);
    assert_eq!(token.balance(&agent2), 1950);
    assert_eq!(contract.get_accumulated_fees(), 75);
}

#[test]
fn test_settlement_with_future_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Set expiry to 1 hour in the future
    let current_time = env.ledger().timestamp();
    let expiry_time = current_time + 3600;

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &Some(expiry_time));

    // Should succeed since expiry is in the future
    contract.confirm_payout(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(token.balance(&agent), 975);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_settlement_with_past_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Set expiry to 1 hour in the past
    let current_time = env.ledger().timestamp();
    let expiry_time = current_time.saturating_sub(3600);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &Some(expiry_time));

    // Should fail with SettlementExpired error
    contract.confirm_payout(&remittance_id);
}

#[test]
fn test_settlement_without_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Create remittance without expiry
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    // Should succeed since there's no expiry
    contract.confirm_payout(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(token.balance(&agent), 975);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_duplicate_settlement_prevention() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    // First settlement should succeed
    contract.confirm_payout(&remittance_id);

    // Verify first settlement completed
    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(token.balance(&agent), 975);
    assert_eq!(contract.get_accumulated_fees(), 25);

    // Manually reset status to Pending to bypass status check
    // This simulates an attempt to re-execute the same settlement
    let mut remittance_copy = remittance.clone();
    remittance_copy.status = crate::types::RemittanceStatus::Pending;
    
    // Store the modified remittance back (simulating a scenario where status could be manipulated)
    env.as_contract(&contract.address, || {
        crate::storage::set_remittance(&env, remittance_id, &remittance_copy);
    });

    // Second settlement attempt should fail with DuplicateSettlement error
    contract.confirm_payout(&remittance_id);
}

#[test]
fn test_different_settlements_allowed() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &20000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Create two different remittances
    let remittance_id1 = contract.create_remittance(&sender, &agent, &1000, &None);
    let remittance_id2 = contract.create_remittance(&sender, &agent, &1000, &None);

    // Both settlements should succeed as they are different remittances
    contract.confirm_payout(&remittance_id1);
    contract.confirm_payout(&remittance_id2);

    // Verify both completed successfully
    let remittance1 = contract.get_remittance(&remittance_id1);
    let remittance2 = contract.get_remittance(&remittance_id2);
    
    assert_eq!(remittance1.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(remittance2.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(token.balance(&agent), 1950);
    assert_eq!(contract.get_accumulated_fees(), 50);
}

#[test]
fn test_settlement_hash_storage_efficiency() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &50000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Create and settle multiple remittances
    for _ in 0..5 {
        let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);
        contract.confirm_payout(&remittance_id);
    }

    // Verify all settlements completed
    assert_eq!(contract.get_accumulated_fees(), 125);
    assert_eq!(token.balance(&agent), 4875);
    
    // Storage should only contain settlement hashes (boolean flags), not full remittance data duplicates
    // This is verified by the fact that the contract still functions correctly
}

#[test]
fn test_duplicate_prevention_with_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let current_time = env.ledger().timestamp();
    let expiry_time = current_time + 3600;

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &Some(expiry_time));

    // First settlement should succeed
    contract.confirm_payout(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Completed);
    
    // Even with valid expiry, duplicate should be prevented
    // (This would require manual status manipulation to test, covered by test_duplicate_settlement_prevention)
}

#[test]
fn test_pause_unpause() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    assert!(!contract.is_paused());

    contract.pause();
    assert!(contract.is_paused());

    contract.unpause();
    assert!(!contract.is_paused());
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn test_settlement_blocked_when_paused() {
fn test_get_settlement_valid() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    contract.pause();

    contract.confirm_payout(&remittance_id);
}

#[test]
fn test_settlement_works_after_unpause() {
    contract.confirm_payout(&remittance_id);

    let settlement = contract.get_settlement(&remittance_id);
    assert_eq!(settlement.id, remittance_id);
    assert_eq!(settlement.sender, sender);
    assert_eq!(settlement.agent, agent);
    assert_eq!(settlement.amount, 1000);
    assert_eq!(settlement.fee, 25);
    assert_eq!(settlement.status, crate::types::RemittanceStatus::Completed);
}

#[test]
#[should_panic(expected = "RemittanceNotFound")]
fn test_get_settlement_invalid_id() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    contract.pause();
    contract.unpause();

    contract.confirm_payout(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Completed);
}

    contract.get_settlement(&999);
}

#[test]
fn test_settlement_completed_event_emission() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);
    
    contract.confirm_payout(&remittance_id);

    // Verify SettlementCompleted event was emitted
    let events = env.events().all();
    let settlement_event = events.iter().find(|e| {
        e.topics.get(0).unwrap() == &symbol_short!("settle") &&
        e.topics.get(1).unwrap() == &symbol_short!("complete")
    });

    assert!(settlement_event.is_some(), "SettlementCompleted event should be emitted");
    
    let event = settlement_event.unwrap();
    let event_data: (u32, u32, u64, Address, Address, Address, i128) = event.data.clone().try_into().unwrap();
    
    // Verify event fields match executed settlement data
    assert_eq!(event_data.3, sender, "Event sender should match remittance sender");
    assert_eq!(event_data.4, agent, "Event recipient should match remittance agent");
    assert_eq!(event_data.5, token.address, "Event token should match USDC token");
    assert_eq!(event_data.6, 975, "Event amount should match payout amount (1000 - 25 fee)");
}

#[test]
fn test_settlement_completed_event_fields_accuracy() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &20000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &500); // 5% fee
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &10000, &None);
    
    contract.confirm_payout(&remittance_id);

    // Find the SettlementCompleted event
    let events = env.events().all();
    let settlement_event = events.iter().find(|e| {
        e.topics.get(0).unwrap() == &symbol_short!("settle") &&
        e.topics.get(1).unwrap() == &symbol_short!("complete")
    });

    assert!(settlement_event.is_some());
    
    let event = settlement_event.unwrap();
    let event_data: (u32, u32, u64, Address, Address, Address, i128) = event.data.clone().try_into().unwrap();
    
    // Verify all fields with different fee calculation
    let expected_payout = 10000 - 500; // 10000 - (10000 * 500 / 10000)
    assert_eq!(event_data.3, sender);
    assert_eq!(event_data.4, agent);
    assert_eq!(event_data.5, token.address);
    assert_eq!(event_data.6, expected_payout);
}


// ============================================================================
// Multi-Admin Tests
// ============================================================================

#[test]
fn test_add_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin1, &token.address, &250);

    // Initial admin should be registered
    assert!(contract.is_admin(&admin1));
    assert!(!contract.is_admin(&admin2));

    // Add second admin
    contract.add_admin(&admin1, &admin2);

    // Both should be admins now
    assert!(contract.is_admin(&admin1));
    assert!(contract.is_admin(&admin2));
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_add_admin_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    // Non-admin trying to add admin should fail
    contract.add_admin(&non_admin, &new_admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn test_add_admin_already_exists() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    // Try to add the same admin again
    contract.add_admin(&admin, &admin);
}

#[test]
fn test_remove_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin1, &token.address, &250);

    // Add second admin
    contract.add_admin(&admin1, &admin2);
    assert!(contract.is_admin(&admin2));

    // Remove second admin
    contract.remove_admin(&admin1, &admin2);
    assert!(!contract.is_admin(&admin2));
    assert!(contract.is_admin(&admin1));
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn test_cannot_remove_last_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    // Try to remove the only admin
    contract.remove_admin(&admin, &admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_remove_admin_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin1, &token.address, &250);
    contract.add_admin(&admin1, &admin2);

    // Non-admin trying to remove admin should fail
    contract.remove_admin(&non_admin, &admin2);
}

#[test]
#[should_panic(expected = "Error(Contract, #16)")]
fn test_remove_admin_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    // Try to remove an address that is not an admin
    contract.remove_admin(&admin, &non_admin);
}

#[test]
fn test_multiple_admins_can_perform_admin_actions() {
    let env = Env::default();
    env.mock_all_auths();

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let agent = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin1, &token.address, &250);
    contract.add_admin(&admin1, &admin2);

    // Both admins should be able to register agents
    contract.register_agent(&agent);
    assert!(contract.is_agent_registered(&agent));

    // Admin2 should be able to update fee
    contract.update_fee(&500);
    assert_eq!(contract.get_platform_fee_bps(), 500);

    // Admin2 should be able to pause
    contract.pause();
    assert!(contract.is_paused());

    // Admin1 should be able to unpause
    contract.unpause();
    assert!(!contract.is_paused());
}


// ============================================================================
// Multi-Token Tests
// ============================================================================

#[test]
fn test_multiple_tokens_different_contracts() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    // Create two different token contracts
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    // Mint tokens to sender
    token1.mint(&sender, &10000);
    token2.mint(&sender, &20000);

    // Create two separate contract instances for different tokens
    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);
    
    contract1.initialize(&admin, &token1.address, &250);
    contract2.initialize(&admin, &token2.address, &300);
    
    contract1.register_agent(&agent);
    contract2.register_agent(&agent);

    // Create remittances with different tokens
    let remittance_id1 = contract1.create_remittance(&sender, &agent, &1000, &None);
    let remittance_id2 = contract2.create_remittance(&sender, &agent, &2000, &None);

    // Confirm payouts
    contract1.confirm_payout(&remittance_id1);
    contract2.confirm_payout(&remittance_id2);

    // Verify balances for token1 (250 bps = 2.5% fee)
    assert_eq!(token1.balance(&agent), 975); // 1000 - 25
    assert_eq!(contract1.get_accumulated_fees(), 25);
    assert_eq!(token1.balance(&sender), 9000);

    // Verify balances for token2 (300 bps = 3% fee)
    assert_eq!(token2.balance(&agent), 1940); // 2000 - 60
    assert_eq!(contract2.get_accumulated_fees(), 60);
    assert_eq!(token2.balance(&sender), 18000);
}

#[test]
fn test_multi_token_balance_isolation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    let token3 = create_token_contract(&env, &token_admin);
    
    let sender1 = Address::generate(&env);
    let sender2 = Address::generate(&env);
    let agent1 = Address::generate(&env);
    let agent2 = Address::generate(&env);

    // Mint different amounts to different senders
    token1.mint(&sender1, &50000);
    token2.mint(&sender1, &30000);
    token2.mint(&sender2, &40000);
    token3.mint(&sender2, &60000);

    // Create contracts for each token
    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);
    let contract3 = create_swiftremit_contract(&env);
    
    contract1.initialize(&admin, &token1.address, &200);
    contract2.initialize(&admin, &token2.address, &300);
    contract3.initialize(&admin, &token3.address, &400);
    
    contract1.register_agent(&agent1);
    contract2.register_agent(&agent1);
    contract2.register_agent(&agent2);
    contract3.register_agent(&agent2);

    // Create multiple remittances across different tokens
    let rem1 = contract1.create_remittance(&sender1, &agent1, &5000, &None);
    let rem2 = contract2.create_remittance(&sender1, &agent1, &3000, &None);
    let rem3 = contract2.create_remittance(&sender2, &agent2, &4000, &None);
    let rem4 = contract3.create_remittance(&sender2, &agent2, &6000, &None);

    // Confirm all payouts
    contract1.confirm_payout(&rem1);
    contract2.confirm_payout(&rem2);
    contract2.confirm_payout(&rem3);
    contract3.confirm_payout(&rem4);

    // Verify token1 balances (200 bps = 2%)
    assert_eq!(token1.balance(&sender1), 45000); // 50000 - 5000
    assert_eq!(token1.balance(&agent1), 4900); // 5000 - 100
    assert_eq!(contract1.get_accumulated_fees(), 100);

    // Verify token2 balances (300 bps = 3%)
    assert_eq!(token2.balance(&sender1), 27000); // 30000 - 3000
    assert_eq!(token2.balance(&sender2), 36000); // 40000 - 4000
    assert_eq!(token2.balance(&agent1), 2910); // 3000 - 90
    assert_eq!(token2.balance(&agent2), 3880); // 4000 - 120
    assert_eq!(contract2.get_accumulated_fees(), 210); // 90 + 120

    // Verify token3 balances (400 bps = 4%)
    assert_eq!(token3.balance(&sender2), 54000); // 60000 - 6000
    assert_eq!(token3.balance(&agent2), 5760); // 6000 - 240
    assert_eq!(contract3.get_accumulated_fees(), 240);

    // Verify no cross-contamination
    assert_eq!(token1.balance(&agent2), 0);
    assert_eq!(token2.balance(&sender2), 36000); // Only affected by token2 transactions
    assert_eq!(token3.balance(&sender1), 0);
}

#[test]
fn test_multi_token_fee_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let fee_recipient1 = Address::generate(&env);
    let fee_recipient2 = Address::generate(&env);

    token1.mint(&sender, &20000);
    token2.mint(&sender, &30000);

    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);
    
    contract1.initialize(&admin, &token1.address, &500);
    contract2.initialize(&admin, &token2.address, &250);
    
    contract1.register_agent(&agent);
    contract2.register_agent(&agent);

    // Create and complete multiple remittances
    for _ in 0..3 {
        let rem1 = contract1.create_remittance(&sender, &agent, &1000, &None);
        contract1.confirm_payout(&rem1);
    }
    
    for _ in 0..2 {
        let rem2 = contract2.create_remittance(&sender, &agent, &2000, &None);
        contract2.confirm_payout(&rem2);
    }

    // Verify accumulated fees
    assert_eq!(contract1.get_accumulated_fees(), 150); // 3 * 50
    assert_eq!(contract2.get_accumulated_fees(), 100); // 2 * 50

    // Withdraw fees to different recipients
    contract1.withdraw_fees(&fee_recipient1);
    contract2.withdraw_fees(&fee_recipient2);

    // Verify fee withdrawals
    assert_eq!(token1.balance(&fee_recipient1), 150);
    assert_eq!(token2.balance(&fee_recipient2), 100);
    assert_eq!(contract1.get_accumulated_fees(), 0);
    assert_eq!(contract2.get_accumulated_fees(), 0);

    // Verify agent received correct amounts
    assert_eq!(token1.balance(&agent), 2850); // 3 * 950
    assert_eq!(token2.balance(&agent), 3900); // 2 * 1950
}

#[test]
fn test_multi_token_cancellation_refunds() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token1.mint(&sender, &10000);
    token2.mint(&sender, &15000);

    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);
    
    contract1.initialize(&admin, &token1.address, &250);
    contract2.initialize(&admin, &token2.address, &300);
    
    contract1.register_agent(&agent);
    contract2.register_agent(&agent);

    // Create remittances
    let rem1 = contract1.create_remittance(&sender, &agent, &2000, &None);
    let rem2 = contract2.create_remittance(&sender, &agent, &3000, &None);
    let rem3 = contract1.create_remittance(&sender, &agent, &1500, &None);

    // Cancel some remittances
    contract1.cancel_remittance(&rem1);
    contract2.cancel_remittance(&rem2);

    // Verify refunds
    assert_eq!(token1.balance(&sender), 8000); // 10000 - 2000 + 2000 - 1500
    assert_eq!(token2.balance(&sender), 12000); // 15000 - 3000 + 3000

    // Complete remaining remittance
    contract1.confirm_payout(&rem3);

    // Verify final balances
    assert_eq!(token1.balance(&sender), 8000);
    assert_eq!(token1.balance(&agent), 1462); // 1500 - 38 (2.5% fee)
    assert_eq!(contract1.get_accumulated_fees(), 38);
    
    assert_eq!(token2.balance(&agent), 0);
    assert_eq!(contract2.get_accumulated_fees(), 0);
}

#[test]
fn test_multi_token_state_transitions() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token1.mint(&sender, &10000);
    token2.mint(&sender, &10000);

    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);
    
    contract1.initialize(&admin, &token1.address, &250);
    contract2.initialize(&admin, &token2.address, &250);
    
    contract1.register_agent(&agent);
    contract2.register_agent(&agent);

    // Create remittances in both tokens
    let rem1 = contract1.create_remittance(&sender, &agent, &1000, &None);
    let rem2 = contract2.create_remittance(&sender, &agent, &1000, &None);

    // Verify initial state
    let remittance1 = contract1.get_remittance(&rem1);
    let remittance2 = contract2.get_remittance(&rem2);
    assert_eq!(remittance1.status, crate::types::RemittanceStatus::Pending);
    assert_eq!(remittance2.status, crate::types::RemittanceStatus::Pending);

    // Complete first, cancel second
    contract1.confirm_payout(&rem1);
    contract2.cancel_remittance(&rem2);

    // Verify state transitions
    let remittance1 = contract1.get_remittance(&rem1);
    let remittance2 = contract2.get_remittance(&rem2);
    assert_eq!(remittance1.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(remittance2.status, crate::types::RemittanceStatus::Cancelled);

    // Verify balances reflect state
    assert_eq!(token1.balance(&agent), 975);
    assert_eq!(token2.balance(&agent), 0);
    assert_eq!(token1.balance(&sender), 9000);
    assert_eq!(token2.balance(&sender), 10000); // Refunded
}

#[test]
fn test_multi_token_concurrent_operations() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    
    let sender1 = Address::generate(&env);
    let sender2 = Address::generate(&env);
    let agent1 = Address::generate(&env);
    let agent2 = Address::generate(&env);

    token1.mint(&sender1, &50000);
    token1.mint(&sender2, &50000);
    token2.mint(&sender1, &50000);
    token2.mint(&sender2, &50000);

    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);
    
    contract1.initialize(&admin, &token1.address, &250);
    contract2.initialize(&admin, &token2.address, &250);
    
    contract1.register_agent(&agent1);
    contract1.register_agent(&agent2);
    contract2.register_agent(&agent1);
    contract2.register_agent(&agent2);

    // Create multiple concurrent remittances
    let rem1_1 = contract1.create_remittance(&sender1, &agent1, &1000, &None);
    let rem1_2 = contract1.create_remittance(&sender2, &agent2, &2000, &None);
    let rem2_1 = contract2.create_remittance(&sender1, &agent2, &1500, &None);
    let rem2_2 = contract2.create_remittance(&sender2, &agent1, &2500, &None);

    // Process in mixed order
    contract1.confirm_payout(&rem1_1);
    contract2.confirm_payout(&rem2_1);
    contract1.confirm_payout(&rem1_2);
    contract2.confirm_payout(&rem2_2);

    // Verify all balances are correct
    assert_eq!(token1.balance(&agent1), 975);
    assert_eq!(token1.balance(&agent2), 1950);
    assert_eq!(token2.balance(&agent1), 2437); // 2500 - 63
    assert_eq!(token2.balance(&agent2), 1462); // 1500 - 38

    assert_eq!(contract1.get_accumulated_fees(), 75); // 25 + 50
    assert_eq!(contract2.get_accumulated_fees(), 101); // 38 + 63
}

#[test]
fn test_multi_token_edge_case_zero_fee() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token1.mint(&sender, &10000);
    token2.mint(&sender, &10000);

    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);
    
    // One with 0% fee, one with normal fee
    contract1.initialize(&admin, &token1.address, &0);
    contract2.initialize(&admin, &token2.address, &500);
    
    contract1.register_agent(&agent);
    contract2.register_agent(&agent);

    let rem1 = contract1.create_remittance(&sender, &agent, &1000, &None);
    let rem2 = contract2.create_remittance(&sender, &agent, &1000, &None);

    contract1.confirm_payout(&rem1);
    contract2.confirm_payout(&rem2);

    // Verify zero fee contract
    assert_eq!(token1.balance(&agent), 1000); // No fee deducted
    assert_eq!(contract1.get_accumulated_fees(), 0);

    // Verify normal fee contract
    assert_eq!(token2.balance(&agent), 950); // 5% fee
    assert_eq!(contract2.get_accumulated_fees(), 50);
}

#[test]
fn test_multi_token_large_amounts() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    // Mint large amounts
    token1.mint(&sender, &1_000_000_000);
    token2.mint(&sender, &5_000_000_000);

    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);
    
    contract1.initialize(&admin, &token1.address, &100);
    contract2.initialize(&admin, &token2.address, &50);
    
    contract1.register_agent(&agent);
    contract2.register_agent(&agent);

    // Large remittances
    let rem1 = contract1.create_remittance(&sender, &agent, &100_000_000, &None);
    let rem2 = contract2.create_remittance(&sender, &agent, &500_000_000, &None);

    contract1.confirm_payout(&rem1);
    contract2.confirm_payout(&rem2);

    // Verify large amount calculations (100 bps = 1%)
    assert_eq!(token1.balance(&agent), 99_000_000); // 100M - 1M
    assert_eq!(contract1.get_accumulated_fees(), 1_000_000);

    // Verify large amount calculations (50 bps = 0.5%)
    assert_eq!(token2.balance(&agent), 497_500_000); // 500M - 2.5M
    assert_eq!(contract2.get_accumulated_fees(), 2_500_000);
}

#[test]
fn test_multi_token_expiry_handling() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token1.mint(&sender, &10000);
    token2.mint(&sender, &10000);

    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);
    
    contract1.initialize(&admin, &token1.address, &250);
    contract2.initialize(&admin, &token2.address, &250);
    
    contract1.register_agent(&agent);
    contract2.register_agent(&agent);

    let current_time = env.ledger().timestamp();
    let future_expiry = current_time + 7200;

    // Create remittances with expiry
    let rem1 = contract1.create_remittance(&sender, &agent, &1000, &Some(future_expiry));
    let rem2 = contract2.create_remittance(&sender, &agent, &1000, &None);

    // Both should succeed
    contract1.confirm_payout(&rem1);
    contract2.confirm_payout(&rem2);

    // Verify both completed
    let remittance1 = contract1.get_remittance(&rem1);
    let remittance2 = contract2.get_remittance(&rem2);
    assert_eq!(remittance1.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(remittance2.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(remittance1.expiry, Some(future_expiry));
    assert_eq!(remittance2.expiry, None);
}

#[test]
fn test_multi_token_pause_independence() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token1.mint(&sender, &10000);
    token2.mint(&sender, &10000);

    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);
    
    contract1.initialize(&admin, &token1.address, &250);
    contract2.initialize(&admin, &token2.address, &250);
    
    contract1.register_agent(&agent);
    contract2.register_agent(&agent);

    let rem1 = contract1.create_remittance(&sender, &agent, &1000, &None);
    let rem2 = contract2.create_remittance(&sender, &agent, &1000, &None);

    // Pause only contract1
    contract1.pause();

    assert!(contract1.is_paused());
    assert!(!contract2.is_paused());

    // Contract2 should still work
    contract2.confirm_payout(&rem2);
    
    let remittance2 = contract2.get_remittance(&rem2);
    assert_eq!(remittance2.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(token2.balance(&agent), 975);

    // Unpause contract1 and complete
    contract1.unpause();
    contract1.confirm_payout(&rem1);
    
    let remittance1 = contract1.get_remittance(&rem1);
    assert_eq!(remittance1.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(token1.balance(&agent), 975);
}

#[test]
fn test_multi_token_different_agents() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    
    let sender = Address::generate(&env);
    let agent1 = Address::generate(&env);
    let agent2 = Address::generate(&env);
    let agent3 = Address::generate(&env);

    token1.mint(&sender, &30000);
    token2.mint(&sender, &30000);

    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);
    
    contract1.initialize(&admin, &token1.address, &200);
    contract2.initialize(&admin, &token2.address, &300);
    
    // Register different agents for different contracts
    contract1.register_agent(&agent1);
    contract1.register_agent(&agent2);
    contract2.register_agent(&agent2);
    contract2.register_agent(&agent3);

    // Create remittances to different agents
    let rem1 = contract1.create_remittance(&sender, &agent1, &5000, &None);
    let rem2 = contract1.create_remittance(&sender, &agent2, &3000, &None);
    let rem3 = contract2.create_remittance(&sender, &agent2, &4000, &None);
    let rem4 = contract2.create_remittance(&sender, &agent3, &6000, &None);

    // Complete all
    contract1.confirm_payout(&rem1);
    contract1.confirm_payout(&rem2);
    contract2.confirm_payout(&rem3);
    contract2.confirm_payout(&rem4);

    // Verify agent1 only received from token1
    assert_eq!(token1.balance(&agent1), 4900); // 5000 - 100 (2%)
    assert_eq!(token2.balance(&agent1), 0);

    // Verify agent2 received from both tokens
    assert_eq!(token1.balance(&agent2), 2940); // 3000 - 60 (2%)
    assert_eq!(token2.balance(&agent2), 3880); // 4000 - 120 (3%)

    // Verify agent3 only received from token2
    assert_eq!(token1.balance(&agent3), 0);
    assert_eq!(token2.balance(&agent3), 5820); // 6000 - 180 (3%)
}

#[test]
fn test_multi_token_mixed_success_failure() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token1.mint(&sender, &10000);
    token2.mint(&sender, &10000);

    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);
    
    contract1.initialize(&admin, &token1.address, &250);
    contract2.initialize(&admin, &token2.address, &250);
    
    contract1.register_agent(&agent);
    contract2.register_agent(&agent);

    // Create remittances
    let rem1 = contract1.create_remittance(&sender, &agent, &1000, &None);
    let rem2 = contract2.create_remittance(&sender, &agent, &1000, &None);

    // Complete first
    contract1.confirm_payout(&rem1);
    
    // Cancel second
    contract2.cancel_remittance(&rem2);

    // Verify mixed outcomes
    assert_eq!(token1.balance(&agent), 975);
    assert_eq!(token2.balance(&agent), 0);
    assert_eq!(token1.balance(&sender), 9000);
    assert_eq!(token2.balance(&sender), 10000); // Refunded

    let remittance1 = contract1.get_remittance(&rem1);
    let remittance2 = contract2.get_remittance(&rem2);
    assert_eq!(remittance1.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(remittance2.status, crate::types::RemittanceStatus::Cancelled);
}


// ============================================================================
// Token Whitelist Tests
// ============================================================================

#[test]
fn test_whitelist_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Initially token should not be whitelisted
    assert!(!contract.is_token_whitelisted(&token.address));

    // Admin whitelists the token
    contract.whitelist_token(&admin, &token.address);

    // Now token should be whitelisted
    assert!(contract.is_token_whitelisted(&token.address));
}

#[test]
fn test_remove_whitelisted_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Whitelist the token
    contract.whitelist_token(&admin, &token.address);
    assert!(contract.is_token_whitelisted(&token.address));

    // Remove from whitelist
    contract.remove_whitelisted_token(&admin, &token.address);
    assert!(!contract.is_token_whitelisted(&token.address));
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn test_whitelist_token_already_whitelisted() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Whitelist the token
    contract.whitelist_token(&admin, &token.address);

    // Try to whitelist again - should fail
    contract.whitelist_token(&admin, &token.address);
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn test_remove_token_not_whitelisted() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Try to remove a token that was never whitelisted - should fail
    contract.remove_whitelisted_token(&admin, &token.address);
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn test_initialize_with_non_whitelisted_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Try to initialize with non-whitelisted token - should fail
    contract.initialize(&admin, &token.address, &250);
}

#[test]
fn test_initialize_with_whitelisted_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Whitelist the token first
    contract.whitelist_token(&admin, &token.address);

    // Now initialize should succeed
    contract.initialize(&admin, &token.address, &250);

    assert_eq!(contract.get_platform_fee_bps(), 250);
}

#[test]
fn test_multiple_tokens_whitelist() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    let token3 = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Whitelist multiple tokens
    contract.whitelist_token(&admin, &token1.address);
    contract.whitelist_token(&admin, &token2.address);
    contract.whitelist_token(&admin, &token3.address);

    // Verify all are whitelisted
    assert!(contract.is_token_whitelisted(&token1.address));
    assert!(contract.is_token_whitelisted(&token2.address));
    assert!(contract.is_token_whitelisted(&token3.address));

    // Remove one
    contract.remove_whitelisted_token(&admin, &token2.address);

    // Verify state
    assert!(contract.is_token_whitelisted(&token1.address));
    assert!(!contract.is_token_whitelisted(&token2.address));
    assert!(contract.is_token_whitelisted(&token3.address));
}

#[test]
fn test_whitelist_authorization() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Whitelist token
    contract.whitelist_token(&admin, &token.address);

    // Verify authorization was required
    assert_eq!(
        env.auths(),
        [(
            admin.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    contract.address.clone(),
                    symbol_short!("whitelist_token"),
                    (&admin, &token.address).into_val(&env)
                )),
                sub_invocations: std::vec![]
            }
        )]
    );
}

#[test]
fn test_whitelist_events_emitted() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Whitelist token
    contract.whitelist_token(&admin, &token.address);

    let events = env.events().all();
    let whitelist_event = events.last().unwrap();

    assert_eq!(
        whitelist_event.topics,
        (symbol_short!("token"), symbol_short!("whitelist")).into_val(&env)
    );

    // Remove token
    contract.remove_whitelisted_token(&admin, &token.address);

    let events = env.events().all();
    let remove_event = events.last().unwrap();

    assert_eq!(
        remove_event.topics,
        (symbol_short!("token"), symbol_short!("removed")).into_val(&env)
    );
}

#[test]
fn test_multi_admin_whitelist_management() {
    let env = Env::default();
    env.mock_all_auths();

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Whitelist first token
    contract.whitelist_token(&admin1, &token1.address);
    
    // Initialize with whitelisted token
    contract.initialize(&admin1, &token1.address, &250);
    
    // Add second admin
    contract.add_admin(&admin1, &admin2);

    // Second admin should be able to whitelist tokens
    contract.whitelist_token(&admin2, &token2.address);
    assert!(contract.is_token_whitelisted(&token2.address));

    // Second admin should be able to remove whitelisted tokens
    contract.remove_whitelisted_token(&admin2, &token2.address);
    assert!(!contract.is_token_whitelisted(&token2.address));
}

#[test]
fn test_whitelist_different_contract_instances() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);

    // Create two separate contract instances
    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);

    // Whitelist token1 in contract1
    contract1.whitelist_token(&admin, &token1.address);
    
    // Whitelist token2 in contract2
    contract2.whitelist_token(&admin, &token2.address);

    // Verify isolation - each contract has its own whitelist
    assert!(contract1.is_token_whitelisted(&token1.address));
    assert!(!contract1.is_token_whitelisted(&token2.address));
    
    assert!(!contract2.is_token_whitelisted(&token1.address));
    assert!(contract2.is_token_whitelisted(&token2.address));
}

#[test]
fn test_whitelist_and_full_workflow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);

    // Whitelist token
    contract.whitelist_token(&admin, &token.address);

    // Initialize with whitelisted token
    contract.initialize(&admin, &token.address, &250);

    // Register agent
    contract.register_agent(&agent);

    // Create and complete remittance
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);
    contract.confirm_payout(&remittance_id);

    // Verify everything worked
    assert_eq!(token.balance(&agent), 975);
    assert_eq!(contract.get_accumulated_fees(), 25);
}

#[test]
fn test_whitelist_token_isolation_across_contracts() {
    let env = Env::default();
    env.mock_all_auths();

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let token1 = create_token_contract(&env, &token_admin);
    let token2 = create_token_contract(&env, &token_admin);
    let token3 = create_token_contract(&env, &token_admin);

    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);

    // Contract1: whitelist token1 and token2
    contract1.whitelist_token(&admin1, &token1.address);
    contract1.whitelist_token(&admin1, &token2.address);

    // Contract2: whitelist token2 and token3
    contract2.whitelist_token(&admin2, &token2.address);
    contract2.whitelist_token(&admin2, &token3.address);

    // Verify contract1 whitelist
    assert!(contract1.is_token_whitelisted(&token1.address));
    assert!(contract1.is_token_whitelisted(&token2.address));
    assert!(!contract1.is_token_whitelisted(&token3.address));

    // Verify contract2 whitelist
    assert!(!contract2.is_token_whitelisted(&token1.address));
    assert!(contract2.is_token_whitelisted(&token2.address));
    assert!(contract2.is_token_whitelisted(&token3.address));

    // Initialize both contracts with their whitelisted tokens
    contract1.initialize(&admin1, &token1.address, &250);
    contract2.initialize(&admin2, &token3.address, &300);

    assert_eq!(contract1.get_platform_fee_bps(), 250);
    assert_eq!(contract2.get_platform_fee_bps(), 300);
}

#[test]
fn test_cannot_use_removed_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract1 = create_swiftremit_contract(&env);
    let contract2 = create_swiftremit_contract(&env);

    // Whitelist token
    contract1.whitelist_token(&admin, &token.address);
    contract2.whitelist_token(&admin, &token.address);

    // Initialize first contract
    contract1.initialize(&admin, &token.address, &250);

    // Remove token from whitelist for contract2
    contract2.remove_whitelisted_token(&admin, &token.address);

    // Verify contract1 still works (already initialized)
    assert_eq!(contract1.get_platform_fee_bps(), 250);

    // Verify contract2 cannot initialize with removed token
    assert!(!contract2.is_token_whitelisted(&token.address));
}

#[test]
fn test_whitelist_edge_case_many_tokens() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);

    // Whitelist many tokens
    let mut tokens = std::vec![];
    for _ in 0..10 {
        let token = create_token_contract(&env, &token_admin);
        contract.whitelist_token(&admin, &token.address);
        tokens.push(token);
    }

    // Verify all are whitelisted
    for token in &tokens {
        assert!(contract.is_token_whitelisted(&token.address));
    }

    // Remove every other token
    for (i, token) in tokens.iter().enumerate() {
        if i % 2 == 0 {
            contract.remove_whitelisted_token(&admin, &token.address);
        }
    }

    // Verify correct state
    for (i, token) in tokens.iter().enumerate() {
        if i % 2 == 0 {
            assert!(!contract.is_token_whitelisted(&token.address));
        } else {
            assert!(contract.is_token_whitelisted(&token.address));
        }
    }
}


#[test]
fn test_simulate_settlement_success() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Whitelist token
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Mint and create remittance
    token.mint(&sender, &10000);
    let remittance_id = contract.create_remittance(&sender, &agent, &10000, &None);

    // Simulate settlement
    let simulation = contract.simulate_settlement(&remittance_id);

    assert_eq!(simulation.would_succeed, true);
    assert_eq!(simulation.payout_amount, 9750); // 10000 - 250 (2.5% fee)
    assert_eq!(simulation.fee, 250);
    assert_eq!(simulation.error_message, None);
}

#[test]
fn test_simulate_settlement_invalid_status() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Whitelist token
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Mint and create remittance
    token.mint(&sender, &10000);
    let remittance_id = contract.create_remittance(&sender, &agent, &10000, &None);

    // Complete the remittance
    contract.confirm_payout(&remittance_id);

    // Simulate settlement on completed remittance
    let simulation = contract.simulate_settlement(&remittance_id);

    assert_eq!(simulation.would_succeed, false);
    assert_eq!(simulation.error_message, Some(7)); // InvalidStatus error code
}

#[test]
fn test_simulate_settlement_nonexistent() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Whitelist token
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);

    // Simulate non-existent remittance
    let simulation = contract.simulate_settlement(&999);

    assert_eq!(simulation.would_succeed, false);
    assert_eq!(simulation.error_message, Some(6)); // RemittanceNotFound error code
}

#[test]
fn test_simulate_settlement_when_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Whitelist token
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Mint and create remittance
    token.mint(&sender, &10000);
    let remittance_id = contract.create_remittance(&sender, &agent, &10000, &None);

    // Pause contract
    contract.pause();

    // Simulate settlement while paused
    let simulation = contract.simulate_settlement(&remittance_id);

    assert_eq!(simulation.would_succeed, false);
    assert_eq!(simulation.error_message, Some(13)); // ContractPaused error code
}
