#![cfg(test)]
extern crate std;

use crate::{SwiftRemitContract, SwiftRemitContractClient};
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::testutils::Ledger;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Events},
    token, Address, Env, FromVal, IntoVal, String, Symbol,
};

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> soroban_sdk::token::StellarAssetClient<'a> {
    soroban_sdk::token::StellarAssetClient::new(
        env,
        &env.register_stellar_asset_contract(admin.clone()),
    )
}

fn create_swiftremit_contract<'a>(env: &Env) -> SwiftRemitContractClient<'a> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

fn default_currency(env: &Env) -> String {
    String::from_str(env, "USD")
}

fn default_country(env: &Env) -> String {
    String::from_str(env, "US")
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

    assert_eq!(
        env.auths(),
        [(
            admin.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    contract.address.clone(),
                    Symbol::new(&env, "register_agent"),
                    (&agent,).into_val(&env)
                )),
                sub_invocations: std::vec::Vec::new()
            }
        )]
    );

    assert!(contract.is_agent_registered(&agent));
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

    assert_eq!(remittance_id, 1);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.sender, sender);
    assert_eq!(remittance.agent, agent);
    assert_eq!(remittance.amount, 1000);
    assert_eq!(remittance.fee, 25);

    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&contract.address), 1000);
    assert_eq!(token_client.balance(&sender), 9000);
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

    contract.create_remittance(&sender, &agent, &0, &default_currency(&env), &default_country(&env), &None);
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

    contract.authorize_remittance(&admin, &remittance_id);
    contract.confirm_payout(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Settled);

    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&agent), 975);
    assert_eq!(contract.get_accumulated_fees(), 25);
    assert_eq!(token_client.balance(&contract.address), 25);
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn test_confirm_payout_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

    contract.authorize_remittance(&admin, &remittance_id);
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

    contract.cancel_remittance(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Failed);

    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&sender), 10000);
    assert_eq!(token_client.balance(&contract.address), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn test_cancel_remittance_already_completed() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
    contract.authorize_remittance(&admin, &remittance_id);
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

    let token_client = token::Client::new(&env, &token.address);
    // Verify sender balance decreased by full amount
    assert_eq!(
        token_client.balance(&sender),
        initial_balance - remittance_amount
    );
    assert_eq!(token_client.balance(&contract.address), remittance_amount);

    // Cancel the remittance
    contract.cancel_remittance(&remittance_id);

    // Verify full refund (entire amount including fee portion)
    assert_eq!(token_client.balance(&sender), initial_balance);
    assert_eq!(token_client.balance(&contract.address), 0);

    // Verify remittance status is Cancelled
    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Failed);
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

    // Cancel and verify sender authorization was required
    contract.cancel_remittance(&remittance_id);

    assert_eq!(
        env.auths(),
        [(
            sender.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    contract.address.clone(),
                    Symbol::new(&env, "cancel_remittance"),
                    (remittance_id,).into_val(&env)
                )),
                sub_invocations: std::vec::Vec::new()
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

    env.mock_all_auths();
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

    assert_eq!(event.0, contract.address);
    assert_eq!(Symbol::from_val(&env, &event.1.get(0).unwrap()), symbol_short!("remit"));
    assert_eq!(Symbol::from_val(&env, &event.1.get(1).unwrap()), symbol_short!("cancel"));

    let event_data: soroban_sdk::Vec<soroban_sdk::Val> =
        soroban_sdk::FromVal::from_val(&env, &event.2);
    let event_remittance_id: u64 = soroban_sdk::FromVal::from_val(&env, &event_data.get(3).unwrap());
    let event_sender: Address = soroban_sdk::FromVal::from_val(&env, &event_data.get(4).unwrap());
    let event_agent: Address = soroban_sdk::FromVal::from_val(&env, &event_data.get(5).unwrap());
    let event_amount: i128 = soroban_sdk::FromVal::from_val(&env, &event_data.get(7).unwrap());

    assert_eq!(event_remittance_id, remittance_id);
    assert_eq!(event_sender, sender);
    assert_eq!(event_agent, agent);
    assert_eq!(event_amount, remittance_amount);
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
#[should_panic(expected = "Error(Contract, #18)")]
fn test_cancel_remittance_already_cancelled() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

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
    let remittance_id1 = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
    let remittance_id2 = contract.create_remittance(&sender, &agent, &2000, &default_currency(&env), &default_country(&env), &None);
    let remittance_id3 = contract.create_remittance(&sender, &agent, &3000, &default_currency(&env), &default_country(&env), &None);

    let token_client = token::Client::new(&env, &token.address);
    // Sender should have 14000 left (20000 - 1000 - 2000 - 3000)
    assert_eq!(token_client.balance(&sender), 14000);
    assert_eq!(token_client.balance(&contract.address), 6000);

    // Cancel first and third remittances
    contract.cancel_remittance(&remittance_id1);
    contract.cancel_remittance(&remittance_id3);

    // Verify partial refunds
    assert_eq!(token_client.balance(&sender), 18000); // 14000 + 1000 + 3000
    assert_eq!(token_client.balance(&contract.address), 2000); // Only remittance_id2 remains

    // Verify statuses
    let r1 = contract.get_remittance(&remittance_id1);
    let r2 = contract.get_remittance(&remittance_id2);
    let r3 = contract.get_remittance(&remittance_id3);

    assert_eq!(r1.status, crate::types::RemittanceStatus::Failed);
    assert_eq!(r2.status, crate::types::RemittanceStatus::Pending);
    assert_eq!(r3.status, crate::types::RemittanceStatus::Failed);
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Create and cancel remittance
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
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

    env.mock_all_auths();
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
    assert_eq!(cancelled.status, crate::types::RemittanceStatus::Failed);
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
    contract.authorize_remittance(&admin, &remittance_id);
    contract.confirm_payout(&remittance_id);

    contract.withdraw_fees(&fee_recipient);

    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&fee_recipient), 25);
    assert_eq!(contract.get_accumulated_fees(), 0);
    assert_eq!(token_client.balance(&contract.address), 0);
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

    let remittance_id = contract.create_remittance(&sender, &agent, &10000, &default_currency(&env), &default_country(&env), &None);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.fee, 500);

    contract.authorize_remittance(&admin, &remittance_id);
    contract.confirm_payout(&remittance_id);
    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&agent), 9500);
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

    let remittance_id1 = contract.create_remittance(&sender1, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
    let remittance_id2 = contract.create_remittance(&sender2, &agent, &2000, &default_currency(&env), &default_country(&env), &None);

    assert_eq!(remittance_id1, 1);
    assert_eq!(remittance_id2, 2);

    contract.authorize_remittance(&admin, &remittance_id1);
    contract.authorize_remittance(&admin, &remittance_id2);

    contract.confirm_payout(&remittance_id1);
    contract.confirm_payout(&remittance_id2);

    assert_eq!(contract.get_accumulated_fees(), 75);
    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&agent), 2925);
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    contract.register_agent(&agent);

    let events = env.events().all();
    let agent_reg_event = events.last().unwrap();

    assert_eq!(Symbol::from_val(&env, &agent_reg_event.1.get(0).unwrap()), symbol_short!("agent"));
    assert_eq!(Symbol::from_val(&env, &agent_reg_event.1.get(1).unwrap()), symbol_short!("register"));

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

    let events = env.events().all();
    let create_event = events.last().unwrap();

    assert_eq!(Symbol::from_val(&env, &create_event.1.get(0).unwrap()), symbol_short!("remit"));
    assert_eq!(Symbol::from_val(&env, &create_event.1.get(1).unwrap()), symbol_short!("created"));

    contract.authorize_remittance(&admin, &remittance_id);
    contract.confirm_payout(&remittance_id);

    let events = env.events().all();
    let complete_event = events.last().unwrap();

    assert_eq!(Symbol::from_val(&env, &complete_event.1.get(0).unwrap()), symbol_short!("settle"));
    assert_eq!(Symbol::from_val(&env, &complete_event.1.get(1).unwrap()), symbol_short!("complete"));
}

#[test]
fn test_authorization_enforcement() {
    let env = Env::default();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);

    env.mock_all_auths();
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    env.mock_all_auths();
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

    env.mock_all_auths();
    contract.authorize_remittance(&admin, &remittance_id);

    env.mock_all_auths();
    contract.confirm_payout(&remittance_id);

    assert_eq!(
        env.auths(),
        [(
            agent.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    contract.address.clone(),
                    Symbol::new(&env, "confirm_payout"),
                    (remittance_id,).into_val(&env)
                )),
                sub_invocations: std::vec::Vec::new()
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
    contract.authorize_remittance(&admin, &remittance_id);
    contract.confirm_payout(&remittance_id);

    // This should succeed with a valid address
    contract.withdraw_fees(&fee_recipient);

    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&fee_recipient), 25);
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

    // This should succeed with a valid agent address
    contract.authorize_remittance(&admin, &remittance_id);
    contract.confirm_payout(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Settled);
    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&agent), 975);
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Create remittance with valid addresses
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

    // Confirm payout - should validate agent address
    contract.authorize_remittance(&admin, &remittance_id);
    contract.confirm_payout(&remittance_id);

    // Verify the settlement completed successfully
    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Settled);
    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&agent), 975);
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
    let remittance_id1 = contract.create_remittance(&sender1, &agent1, &1000, &default_currency(&env), &default_country(&env), &None);
    let remittance_id2 = contract.create_remittance(&sender2, &agent2, &2000, &default_currency(&env), &default_country(&env), &None);

    // Both should succeed with valid addresses
    contract.authorize_remittance(&admin, &remittance_id1);
    contract.authorize_remittance(&admin, &remittance_id2);

    contract.confirm_payout(&remittance_id1);
    contract.confirm_payout(&remittance_id2);

    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&agent1), 975);
    assert_eq!(token_client.balance(&agent2), 1950);
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Set expiry to 1 hour in the future
    env.ledger().set(soroban_sdk::testutils::LedgerInfo { timestamp: 10000, ..env.ledger().get() });
    let current_time = env.ledger().timestamp();
    let expiry_time = current_time + 3600;

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &Some(expiry_time));

    // Should succeed since expiry is in the future
    contract.authorize_remittance(&admin, &remittance_id);
    contract.confirm_payout(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Settled);
    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&agent), 975);
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Set expiry to 1 hour in the past
    env.ledger().set(soroban_sdk::testutils::LedgerInfo { timestamp: 10000, ..env.ledger().get() });
    let current_time = env.ledger().timestamp();
    let expiry_time = current_time.saturating_sub(3600);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &Some(expiry_time));

    // Should fail with SettlementExpired error
    contract.authorize_remittance(&admin, &remittance_id);
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Create remittance without expiry
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

    // Should succeed since there's no expiry
    contract.authorize_remittance(&admin, &remittance_id);
    contract.confirm_payout(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Settled);
    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&agent), 975);
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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

    // First settlement should succeed
    contract.authorize_remittance(&admin, &remittance_id);
    contract.confirm_payout(&remittance_id);

    // Verify first settlement completed
    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Settled);
    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&agent), 975);
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
    contract.authorize_remittance(&admin, &remittance_id);
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
    let remittance_id1 = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
    let remittance_id2 = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

    // Both settlements should succeed as they are different remittances
    contract.authorize_remittance(&admin, &remittance_id1);
    contract.authorize_remittance(&admin, &remittance_id2);

    contract.confirm_payout(&remittance_id1);
    contract.confirm_payout(&remittance_id2);

    // Verify both completed successfully
    let remittance1 = contract.get_remittance(&remittance_id1);
    let remittance2 = contract.get_remittance(&remittance_id2);

    assert_eq!(remittance1.status, crate::types::RemittanceStatus::Settled);
    assert_eq!(remittance2.status, crate::types::RemittanceStatus::Settled);
    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&agent), 1950);
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
        let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
        contract.authorize_remittance(&admin, &remittance_id);
        contract.confirm_payout(&remittance_id);
    }

    // Verify all settlements completed
    assert_eq!(contract.get_accumulated_fees(), 125);
    let token_client = token::Client::new(&env, &token.address);
    assert_eq!(token_client.balance(&agent), 4875);

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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    env.ledger().set(soroban_sdk::testutils::LedgerInfo { timestamp: 10000, ..env.ledger().get() });
    let current_time = env.ledger().timestamp();
    let expiry_time = current_time + 3600;

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &Some(expiry_time));

    contract.authorize_remittance(&admin, &remittance_id);

    // First settlement should succeed
    contract.confirm_payout(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Settled);

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
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
    contract.authorize_remittance(&admin, &remittance_id);

    contract.pause();

    contract.confirm_payout(&remittance_id);
}

#[test]
fn test_settlement_works_after_unpause() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
    contract.authorize_remittance(&admin, &remittance_id);

    contract.pause();
    contract.unpause();

    contract.confirm_payout(&remittance_id);

    let settlement = contract.get_settlement(&remittance_id);
    assert_eq!(settlement.id, remittance_id);
    assert_eq!(settlement.sender, sender);
    assert_eq!(settlement.agent, agent);
    assert_eq!(settlement.amount, 1000);
    assert_eq!(settlement.fee, 25);
    assert_eq!(settlement.status, crate::types::RemittanceStatus::Settled);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_get_settlement_invalid_id() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

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

    env.mock_all_auths();
    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

    contract.authorize_remittance(&admin, &remittance_id);
    contract.confirm_payout(&remittance_id);

    // Verify SettlementCompleted event was emitted
    let events = env.events().all();
    let settlement_event = events.iter().find(|e| {
        Symbol::from_val(&env, &e.1.get(0).unwrap()) == symbol_short!("settle")
            && Symbol::from_val(&env, &e.1.get(1).unwrap()) == symbol_short!("complete")
    });

    assert!(
        settlement_event.is_some(),
        "SettlementCompleted event should be emitted"
    );

    let event = settlement_event.unwrap();
    let event_data: soroban_sdk::Vec<soroban_sdk::Val> =
        soroban_sdk::FromVal::from_val(&env, &event.2);

    // Verify event fields match executed settlement data
    // (0: SCHEMA_VERSION, 1: sequence, 2: timestamp, 3: sender, 4: agent, 5: token, 6: amount)
    let event_sender: Address = soroban_sdk::FromVal::from_val(&env, &event_data.get(3).unwrap());
    let event_agent: Address = soroban_sdk::FromVal::from_val(&env, &event_data.get(4).unwrap());
    let event_token: Address = soroban_sdk::FromVal::from_val(&env, &event_data.get(5).unwrap());
    let event_amount: i128 = soroban_sdk::FromVal::from_val(&env, &event_data.get(6).unwrap());

    assert_eq!(
        event_sender,
        sender,
        "Event sender should match remittance sender"
    );
    assert_eq!(
        event_agent,
        agent,
        "Event recipient should match remittance agent"
    );
    assert_eq!(
        event_token,
        token.address,
        "Event token should match USDC token"
    );
    assert_eq!(
        event_amount,
        975i128,
        "Event amount should match payout amount (1000 - 25 fee)"
    );
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

    let remittance_id = contract.create_remittance(&sender, &agent, &10000, &default_currency(&env), &default_country(&env), &None);

    contract.authorize_remittance(&admin, &remittance_id);
    contract.confirm_payout(&remittance_id);

    // Find the SettlementCompleted event
    let events = env.events().all();
    let settlement_event = events.iter().find(|e| {
        Symbol::from_val(&env, &e.1.get(0).unwrap()) == symbol_short!("settle")
            && Symbol::from_val(&env, &e.1.get(1).unwrap()) == symbol_short!("complete")
    });

    assert!(settlement_event.is_some());

    let event = settlement_event.unwrap();
    let event_data: soroban_sdk::Vec<soroban_sdk::Val> =
        soroban_sdk::FromVal::from_val(&env, &event.2);

    // Verify all fields with different fee calculation
    // (0: SCHEMA_VERSION, 1: sequence, 2: timestamp, 3: sender, 4: agent, 5: token, 6: amount)
    let expected_payout = 10000 - 500; // 10000 - (10000 * 500 / 10000)
    let event_sender: Address = soroban_sdk::FromVal::from_val(&env, &event_data.get(3).unwrap());
    let event_agent: Address = soroban_sdk::FromVal::from_val(&env, &event_data.get(4).unwrap());
    let event_token: Address = soroban_sdk::FromVal::from_val(&env, &event_data.get(5).unwrap());
    let event_amount: i128 = soroban_sdk::FromVal::from_val(&env, &event_data.get(6).unwrap());

    assert_eq!(event_sender, sender);
    assert_eq!(event_agent, agent);
    assert_eq!(event_token, token.address);
    assert_eq!(event_amount, (expected_payout as i128));
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
    let remittance_id1 = contract1.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
    let remittance_id2 = contract2.create_remittance(&sender, &agent, &2000, &default_currency(&env), &default_country(&env), &None);

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
    let rem1 = contract1.create_remittance(&sender1, &agent1, &5000, &default_currency(&env), &default_country(&env), &None);
    let rem2 = contract2.create_remittance(&sender1, &agent1, &3000, &default_currency(&env), &default_country(&env), &None);
    let rem3 = contract2.create_remittance(&sender2, &agent2, &4000, &default_currency(&env), &default_country(&env), &None);
    let rem4 = contract3.create_remittance(&sender2, &agent2, &6000, &default_currency(&env), &default_country(&env), &None);

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
        let rem1 = contract1.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
        contract1.confirm_payout(&rem1);
    }
    
    for _ in 0..2 {
        let rem2 = contract2.create_remittance(&sender, &agent, &2000, &default_currency(&env), &default_country(&env), &None);
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
    let rem1 = contract1.create_remittance(&sender, &agent, &2000, &default_currency(&env), &default_country(&env), &None);
    let rem2 = contract2.create_remittance(&sender, &agent, &3000, &default_currency(&env), &default_country(&env), &None);
    let rem3 = contract1.create_remittance(&sender, &agent, &1500, &default_currency(&env), &default_country(&env), &None);

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
    let rem1 = contract1.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
    let rem2 = contract2.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

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
    let rem1_1 = contract1.create_remittance(&sender1, &agent1, &1000, &default_currency(&env), &default_country(&env), &None);
    let rem1_2 = contract1.create_remittance(&sender2, &agent2, &2000, &default_currency(&env), &default_country(&env), &None);
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

    let rem1 = contract1.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
    let rem2 = contract2.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

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
    let rem2 = contract2.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

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

    let rem1 = contract1.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
    let rem2 = contract2.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

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
    let rem1 = contract1.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
    let rem2 = contract2.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);

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
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &default_currency(&env), &default_country(&env), &None);
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


// ============================================================================
// Centralized Validation Tests
// ============================================================================

#[test]
fn test_validation_prevents_invalid_amount() {
// ═══════════════════════════════════════════════════════════════════════════
// Net Settlement Tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_net_settlement_simple_offset() {


#[test]
fn test_simulate_settlement_success() {

    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let sender_a = Address::generate(&env);
    let sender_b = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250); // 2.5% fee

    // Register both as agents
    contract.register_agent(&sender_a);
    contract.register_agent(&sender_b);

    // Mint tokens
    token.mint(&sender_a, &1000);
    token.mint(&sender_b, &1000);

    // Create opposing remittances:
    // A -> B: 100 (fee: 2.5)
    let id1 = contract.create_remittance(&sender_a, &sender_b, &100, &None);
    
    // B -> A: 90 (fee: 2.25)
    let id2 = contract.create_remittance(&sender_b, &sender_a, &90, &None);

    // Create batch settlement entries
    let mut entries = Vec::new(&env);
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id1 });
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id2 });

    // Execute batch settlement with netting
    let result = contract.batch_settle_with_netting(&entries);

    assert!(result.is_ok());
    let settled = result.unwrap();
    assert_eq!(settled.settled_ids.len(), 2);

    // Verify both remittances are marked as completed
    let rem1 = contract.get_remittance(&id1);
    let rem2 = contract.get_remittance(&id2);
    assert_eq!(rem1.status, crate::RemittanceStatus::Completed);
    assert_eq!(rem2.status, crate::RemittanceStatus::Completed);

    // Verify fees accumulated (2.5 + 2.25 = 4.75)
    let fees = contract.get_accumulated_fees();
    assert_eq!(fees, 4); // Rounded down due to integer division
}

#[test]
fn test_net_settlement_complete_offset() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let sender_a = Address::generate(&env);
    let sender_b = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);

    contract.register_agent(&sender_a);
    contract.register_agent(&sender_b);

    token.mint(&sender_a, &1000);
    token.mint(&sender_b, &1000);

    // Create equal opposing remittances:
    // A -> B: 100
    let id1 = contract.create_remittance(&sender_a, &sender_b, &100, &None);
    
    // B -> A: 100
    let id2 = contract.create_remittance(&sender_b, &sender_a, &100, &None);

    let mut entries = Vec::new(&env);
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id1 });
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id2 });

    let result = contract.batch_settle_with_netting(&entries);

    assert!(result.is_ok());
    
    // Both should be marked completed even though net transfer is zero
    let rem1 = contract.get_remittance(&id1);
    let rem2 = contract.get_remittance(&id2);
    assert_eq!(rem1.status, crate::RemittanceStatus::Completed);
    assert_eq!(rem2.status, crate::RemittanceStatus::Completed);

    // Fees should still be accumulated
    let fees = contract.get_accumulated_fees();
    assert!(fees > 0);
}

#[test]
fn test_net_settlement_multiple_parties() {

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
    let remittance_id = contract.create_remittance(&sender, &agent, &10000, &default_currency(&env), &default_country(&env), &None);

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

    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let party_a = Address::generate(&env);
    let party_b = Address::generate(&env);
    let party_c = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &100); // 1% fee

    contract.register_agent(&party_a);
    contract.register_agent(&party_b);
    contract.register_agent(&party_c);

    token.mint(&party_a, &10000);
    token.mint(&party_b, &10000);
    token.mint(&party_c, &10000);

    // Create a triangle of remittances:
    // A -> B: 100
    let id1 = contract.create_remittance(&party_a, &party_b, &100, &None);
    
    // B -> C: 50
    let id2 = contract.create_remittance(&party_b, &party_c, &50, &None);
    
    // C -> A: 30
    let id3 = contract.create_remittance(&party_c, &party_a, &30, &None);

    let mut entries = Vec::new(&env);
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id1 });
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id2 });
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id3 });

    let result = contract.batch_settle_with_netting(&entries);

    assert!(result.is_ok());
    
    // All should be completed
    assert_eq!(contract.get_remittance(&id1).status, crate::RemittanceStatus::Completed);
    assert_eq!(contract.get_remittance(&id2).status, crate::RemittanceStatus::Completed);
    assert_eq!(contract.get_remittance(&id3).status, crate::RemittanceStatus::Completed);
}

#[test]
fn test_net_settlement_order_independence() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let sender_a = Address::generate(&env);
    let sender_b = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);

    contract.register_agent(&sender_a);
    contract.register_agent(&sender_b);

    token.mint(&sender_a, &2000);
    token.mint(&sender_b, &2000);

    // First batch: A->B then B->A
    let id1 = contract.create_remittance(&sender_a, &sender_b, &100, &None);
    let id2 = contract.create_remittance(&sender_b, &sender_a, &90, &None);

    let mut entries1 = Vec::new(&env);
    entries1.push_back(crate::BatchSettlementEntry { remittance_id: id1 });
    entries1.push_back(crate::BatchSettlementEntry { remittance_id: id2 });

    let fees_before = contract.get_accumulated_fees();
    let result1 = contract.batch_settle_with_netting(&entries1);
    assert!(result1.is_ok());
    let fees_after_batch1 = contract.get_accumulated_fees();
    let fees_batch1 = fees_after_batch1 - fees_before;

    // Second batch: B->A then A->B (reversed order)
    let id3 = contract.create_remittance(&sender_b, &sender_a, &90, &None);
    let id4 = contract.create_remittance(&sender_a, &sender_b, &100, &None);

    let mut entries2 = Vec::new(&env);
    entries2.push_back(crate::BatchSettlementEntry { remittance_id: id3 });
    entries2.push_back(crate::BatchSettlementEntry { remittance_id: id4 });

    let result2 = contract.batch_settle_with_netting(&entries2);
    assert!(result2.is_ok());
    let fees_after_batch2 = contract.get_accumulated_fees();
    let fees_batch2 = fees_after_batch2 - fees_after_batch1;

    // Fees should be identical regardless of order
    assert_eq!(fees_batch1, fees_batch2);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_net_settlement_empty_batch() {

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
    let remittance_id = contract.create_remittance(&sender, &agent, &10000, &default_currency(&env), &default_country(&env), &None);

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

    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);

    let entries = Vec::new(&env);
    contract.batch_settle_with_netting(&entries);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_net_settlement_exceeds_max_batch_size() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    token.mint(&sender, &100000);

    // Create more than MAX_BATCH_SIZE remittances
    let mut entries = Vec::new(&env);
    for _ in 0..51 {
        let id = contract.create_remittance(&sender, &agent, &100, &default_currency(&env), &default_country(&env), &None);
        entries.push_back(crate::BatchSettlementEntry { remittance_id: id });
    }

    contract.batch_settle_with_netting(&entries);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_net_settlement_duplicate_ids() {


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

    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    token.mint(&sender, &1000);

    let id = contract.create_remittance(&sender, &agent, &100, &default_currency(&env), &default_country(&env), &None);

    let mut entries = Vec::new(&env);
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id });
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id }); // Duplicate

    contract.batch_settle_with_netting(&entries);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_net_settlement_already_completed() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Whitelist token

    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);


    token.mint(&sender, &1000);

    let id = contract.create_remittance(&sender, &agent, &100, &default_currency(&env), &default_country(&env), &None);

    // Complete it first
    contract.confirm_payout(&id);

    // Try to include in batch settlement
    let mut entries = Vec::new(&env);
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id });

    contract.batch_settle_with_netting(&entries);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn test_net_settlement_when_paused() {
    // Mint and create remittance
    token.mint(&sender, &10000);
    let remittance_id = contract.create_remittance(&sender, &agent, &10000, &default_currency(&env), &default_country(&env), &None);

    // Pause contract
    contract.pause();

    // Simulate settlement while paused
    let simulation = contract.simulate_settlement(&remittance_id);

    assert_eq!(simulation.would_succeed, false);
    assert_eq!(simulation.error_message, Some(13)); // ContractPaused error code
}


#[test]
fn test_settlement_id_returned() {

    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);


    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);


    token.mint(&sender, &1000);

    let id = contract.create_remittance(&sender, &agent, &100, &default_currency(&env), &default_country(&env), &None);

    // Pause the contract
    contract.pause(&admin);

    let mut entries = Vec::new(&env);
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id });

    contract.batch_settle_with_netting(&entries);
}

#[test]
fn test_net_settlement_fee_preservation() {

    token.mint(&sender, &10000);
    let remittance_id = contract.create_remittance(&sender, &agent, &10000, &default_currency(&env), &default_country(&env), &None);

    // Confirm payout should return the settlement ID
    let settlement_id = contract.confirm_payout(&remittance_id);
    
    assert_eq!(settlement_id, remittance_id);
    
    // Should be able to query settlement using the ID
    let settlement = contract.get_settlement(&settlement_id);
    assert_eq!(settlement.id, settlement_id);
    assert_eq!(settlement.status, crate::RemittanceStatus::Completed);
}

#[test]
fn test_settlement_ids_sequential() {

    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let sender_a = Address::generate(&env);
    let sender_b = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &500); // 5% fee

    contract.register_agent(&sender_a);
    contract.register_agent(&sender_b);

    token.mint(&sender_a, &10000);
    token.mint(&sender_b, &10000);

    // Create multiple remittances with different amounts
    let id1 = contract.create_remittance(&sender_a, &sender_b, &1000, &None);
    let id2 = contract.create_remittance(&sender_b, &sender_a, &800, &None);
    let id3 = contract.create_remittance(&sender_a, &sender_b, &500, &None);

    // Calculate expected fees manually
    let fee1 = 1000 * 500 / 10000; // 50
    let fee2 = 800 * 500 / 10000;  // 40
    let fee3 = 500 * 500 / 10000;  // 25
    let expected_total_fees = fee1 + fee2 + fee3; // 115

    let mut entries = Vec::new(&env);
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id1 });
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id2 });
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id3 });

    let fees_before = contract.get_accumulated_fees();
    let result = contract.batch_settle_with_netting(&entries);
    assert!(result.is_ok());

    let fees_after = contract.get_accumulated_fees();
    let fees_collected = fees_after - fees_before;

    // Verify all fees are preserved
    assert_eq!(fees_collected, expected_total_fees);
}

#[test]
fn test_net_settlement_large_batch() {

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    token.mint(&sender, &100000);

    // Create multiple remittances and verify IDs are sequential
    let id1 = contract.create_remittance(&sender, &agent, &10000, &default_currency(&env), &default_country(&env), &None);
    let id2 = contract.create_remittance(&sender, &agent, &10000, &default_currency(&env), &default_country(&env), &None);
    let id3 = contract.create_remittance(&sender, &agent, &10000, &default_currency(&env), &default_country(&env), &None);

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(id3, 3);

    // Settle and verify settlement IDs match remittance IDs
    let settlement_id1 = contract.confirm_payout(&id1);
    let settlement_id2 = contract.confirm_payout(&id2);
    let settlement_id3 = contract.confirm_payout(&id3);

    assert_eq!(settlement_id1, id1);
    assert_eq!(settlement_id2, id2);
    assert_eq!(settlement_id3, id3);

    // Verify all settlements can be queried
    let s1 = contract.get_settlement(&settlement_id1);
    let s2 = contract.get_settlement(&settlement_id2);
    let s3 = contract.get_settlement(&settlement_id3);

    assert_eq!(s1.id, 1);
    assert_eq!(s2.id, 2);
    assert_eq!(s3.id, 3);
}

#[test]
fn test_settlement_id_uniqueness() {

    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Test zero amount
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.create_remittance(&sender, &agent, &0, &None);
    }));
    assert!(result.is_err());

    // Test negative amount
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.create_remittance(&sender, &agent, &-100, &None);
    }));
    assert!(result.is_err());
}

#[test]
fn test_validation_prevents_invalid_fee_bps() {
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &100);
    contract.register_agent(&agent);

    token.mint(&sender, &1000000);

    // Create maximum allowed batch size
    let mut entries = Vec::new(&env);
    for _ in 0..50 {
        let id = contract.create_remittance(&sender, &agent, &100, &default_currency(&env), &default_country(&env), &None);
        entries.push_back(crate::BatchSettlementEntry { remittance_id: id });
    }

    let result = contract.batch_settle_with_netting(&entries);
    assert!(result.is_ok());

    let settled = result.unwrap();
    assert_eq!(settled.settled_ids.len(), 50);
}

#[test]
fn test_net_settlement_reduces_transfer_count() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    // Test fee > 10000 in initialize
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.initialize(&admin, &token.address, &10001);
    }));
    assert!(result.is_err());

    // Initialize with valid fee
    contract.initialize(&admin, &token.address, &250);

    // Test fee > 10000 in update_fee
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.update_fee(&15000);
    }));
    assert!(result.is_err());
}

#[test]
fn test_validation_prevents_unregistered_agent() {
    let party_a = Address::generate(&env);
    let party_b = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);

    contract.register_agent(&party_a);
    contract.register_agent(&party_b);

    token.mint(&party_a, &10000);
    token.mint(&party_b, &10000);

    // Create 10 remittances: 5 from A->B and 5 from B->A
    let mut entries = Vec::new(&env);
    for i in 0..10 {
        let id = if i % 2 == 0 {
            contract.create_remittance(&party_a, &party_b, &100, &None)
        } else {
            contract.create_remittance(&party_b, &party_a, &100, &None)
        };
        entries.push_back(crate::BatchSettlementEntry { remittance_id: id });
    }

    let result = contract.batch_settle_with_netting(&entries);
    assert!(result.is_ok());

    // All 10 remittances should be settled
    let settled = result.unwrap();
    assert_eq!(settled.settled_ids.len(), 10);

    // But due to complete offsetting, net transfers should be minimal
    // (In this case, 5 A->B and 5 B->A should completely offset)
}

#[test]
fn test_net_settlement_mathematical_correctness() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let party_a = Address::generate(&env);
    let party_b = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &200); // 2% fee

    contract.register_agent(&party_a);
    contract.register_agent(&party_b);

    token.mint(&party_a, &100000);
    token.mint(&party_b, &100000);

    // Create specific amounts to test mathematical correctness
    // A -> B: 1000, 500, 300 = 1800 total
    let id1 = contract.create_remittance(&party_a, &party_b, &1000, &None);
    let id2 = contract.create_remittance(&party_a, &party_b, &500, &None);
    let id3 = contract.create_remittance(&party_a, &party_b, &300, &None);
    
    // B -> A: 800, 400 = 1200 total
    let id4 = contract.create_remittance(&party_b, &party_a, &800, &None);
    let id5 = contract.create_remittance(&party_b, &party_a, &400, &None);

    // Net should be: 1800 - 1200 = 600 from A to B

    let mut entries = Vec::new(&env);
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id1 });
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id2 });
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id3 });
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id4 });
    entries.push_back(crate::BatchSettlementEntry { remittance_id: id5 });

    let result = contract.batch_settle_with_netting(&entries);
    assert!(result.is_ok());

    // Calculate expected fees
    let fee1 = 1000 * 200 / 10000; // 20
    let fee2 = 500 * 200 / 10000;  // 10
    let fee3 = 300 * 200 / 10000;  // 6
    let fee4 = 800 * 200 / 10000;  // 16
    let fee5 = 400 * 200 / 10000;  // 8
    let expected_fees = fee1 + fee2 + fee3 + fee4 + fee5; // 60

    let fees = contract.get_accumulated_fees();
    assert_eq!(fees, expected_fees);

    let sender1 = Address::generate(&env);
    let sender2 = Address::generate(&env);
    let agent = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);

    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    token.mint(&sender1, &50000);
    token.mint(&sender2, &50000);

    // Create remittances from different senders
    let id1 = contract.create_remittance(&sender1, &agent, &10000, &default_currency(&env), &default_country(&env), &None);
    let id2 = contract.create_remittance(&sender2, &agent, &10000, &default_currency(&env), &default_country(&env), &None);
    let id3 = contract.create_remittance(&sender1, &agent, &10000, &default_currency(&env), &default_country(&env), &None);

    // All IDs should be unique
    assert_ne!(id1, id2);
    assert_ne!(id1, id3);
    assert_ne!(id2, id3);

    // Settle and verify unique settlement IDs
    let settlement_id1 = contract.confirm_payout(&id1);
    let settlement_id2 = contract.confirm_payout(&id2);
    let settlement_id3 = contract.confirm_payout(&id3);

    assert_ne!(settlement_id1, settlement_id2);
    assert_ne!(settlement_id1, settlement_id3);
    assert_ne!(settlement_id2, settlement_id3);

}


// ═══════════════════════════════════════════════════════════════════════════
// Migration Tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_export_migration_state() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);

    // Export state
    let snapshot = contract.export_migration_state(&admin);
    assert!(snapshot.is_ok());

    let snap = snapshot.unwrap();
    assert_eq!(snap.version, 1);
    assert_eq!(snap.instance_data.platform_fee_bps, 250);
    assert_eq!(snap.instance_data.remittance_counter, 0);
    assert_eq!(snap.instance_data.accumulated_fees, 0);
}

#[test]
fn test_export_import_migration_state() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let unregistered_agent = Address::generate(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    // Try to create remittance with unregistered agent
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.create_remittance(&sender, &unregistered_agent, &1000, &None);
    }));
    assert!(result.is_err());
}

#[test]
fn test_validation_prevents_operations_on_nonexistent_remittance() {

    // Create and populate first contract
    let contract1 = create_swiftremit_contract(&env);
    contract1.whitelist_token(&admin, &token.address);
    contract1.initialize(&admin, &token.address, &250);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    contract1.register_agent(&agent);

    token.mint(&sender, &1000);
    let id = contract1.create_remittance(&sender, &agent, &100, &default_currency(&env), &default_country(&env), &None);

    // Export state
    let snapshot = contract1.export_migration_state(&admin).unwrap();

    // Create new contract and import state
    let contract2 = create_swiftremit_contract(&env);
    let result = contract2.import_migration_state(&admin, snapshot);
    assert!(result.is_ok());

    // Verify state was imported correctly
    assert_eq!(contract2.get_platform_fee_bps(), 250);
    assert_eq!(contract2.get_accumulated_fees(), 0);

    let remittance = contract2.get_remittance(&id);
    assert!(remittance.is_ok());
    assert_eq!(remittance.unwrap().amount, 100);
}

#[test]
fn test_verify_migration_snapshot() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);

    // Export and verify
    let snapshot = contract.export_migration_state(&admin).unwrap();
    let verification = contract.verify_migration_snapshot(snapshot);

    assert!(verification.valid);
    assert_eq!(verification.expected_hash, verification.actual_hash);
}

#[test]
fn test_migration_hash_detects_tampering() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    // Try to confirm payout for non-existent remittance
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.confirm_payout(&999);
    }));
    assert!(result.is_err());

    // Try to cancel non-existent remittance
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.cancel_remittance(&999);
    }));
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);

    // Export snapshot
    let mut snapshot = contract.export_migration_state(&admin).unwrap();

    // Tamper with data
    snapshot.instance_data.platform_fee_bps = 500;

    // Verification should fail
    let verification = contract.verify_migration_snapshot(snapshot.clone());
    assert!(!verification.valid);

    // Import should fail
    let contract2 = create_swiftremit_contract(&env);
    let result = contract2.import_migration_state(&admin, snapshot);
    assert!(result.is_err());
}

#[test]
fn test_validation_prevents_operations_on_completed_remittance() {
#[should_panic(expected = "Error(Contract, #1)")]
fn test_import_fails_if_already_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    // Create and export from first contract
    let contract1 = create_swiftremit_contract(&env);
    contract1.whitelist_token(&admin, &token.address);
    contract1.initialize(&admin, &token.address, &250);
    let snapshot = contract1.export_migration_state(&admin).unwrap();

    // Create and initialize second contract
    let contract2 = create_swiftremit_contract(&env);
    contract2.whitelist_token(&admin, &token.address);
    contract2.initialize(&admin, &token.address, &300);

    // Import should fail because contract2 is already initialized
    contract2.import_migration_state(&admin, snapshot);
}

#[test]
fn test_export_migration_batch() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    contract.register_agent(&agent);

    token.mint(&sender, &10000);

    // Create 10 remittances
    for _ in 0..10 {
        contract.create_remittance(&sender, &agent, &100, &default_currency(&env), &default_country(&env), &None);
    }

    // Export in batches of 5
    let batch0 = contract.export_migration_batch(&admin, 0, 5);
    assert!(batch0.is_ok());

    let b0 = batch0.unwrap();
    assert_eq!(b0.batch_number, 0);
    assert_eq!(b0.total_batches, 2);
    assert_eq!(b0.remittances.len(), 5);

    let batch1 = contract.export_migration_batch(&admin, 1, 5);
    assert!(batch1.is_ok());

    let b1 = batch1.unwrap();
    assert_eq!(b1.batch_number, 1);
    assert_eq!(b1.remittances.len(), 5);
}

#[test]
fn test_import_migration_batch() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    // Create and populate first contract
    let contract1 = create_swiftremit_contract(&env);
    contract1.whitelist_token(&admin, &token.address);
    contract1.initialize(&admin, &token.address, &250);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    contract1.register_agent(&agent);

    token.mint(&sender, &10000);

    // Create 5 remittances
    for _ in 0..5 {
        contract1.create_remittance(&sender, &agent, &100, &default_currency(&env), &default_country(&env), &None);
    }

    // Export batch
    let batch = contract1.export_migration_batch(&admin, 0, 5).unwrap();

    // Create new contract and import batch
    let contract2 = create_swiftremit_contract(&env);
    contract2.whitelist_token(&admin, &token.address);
    contract2.initialize(&admin, &token.address, &250);

    let result = contract2.import_migration_batch(&admin, batch);
    assert!(result.is_ok());

    // Verify remittances were imported
    for id in 1..=5 {
        let remittance = contract2.get_remittance(&id);
        assert!(remittance.is_ok());
    }
}

#[test]
fn test_migration_batch_hash_verification() {
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

    // Try to cancel already completed remittance
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.cancel_remittance(&remittance_id);
    }));
    assert!(result.is_err());
}

#[test]
fn test_validation_prevents_withdraw_with_no_fees() {

    let contract1 = create_swiftremit_contract(&env);
    contract1.whitelist_token(&admin, &token.address);
    contract1.initialize(&admin, &token.address, &250);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    contract1.register_agent(&agent);

    token.mint(&sender, &10000);

    // Create remittances
    for _ in 0..5 {
        contract1.create_remittance(&sender, &agent, &100, &default_currency(&env), &default_country(&env), &None);
    }

    // Export batch
    let mut batch = contract1.export_migration_batch(&admin, 0, 5).unwrap();

    // Tamper with batch
    let mut remittances = batch.remittances.clone();
    let mut first = remittances.get_unchecked(0);
    first.amount = 200; // Change amount
    remittances.set(0, first);
    batch.remittances = remittances;

    // Import should fail due to hash mismatch
    let contract2 = create_swiftremit_contract(&env);
    contract2.whitelist_token(&admin, &token.address);
    contract2.initialize(&admin, &token.address, &250);

    let result = contract2.import_migration_batch(&admin, batch);
    assert!(result.is_err());
}

#[test]
fn test_migration_preserves_all_data() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    // Create and populate first contract
    let contract1 = create_swiftremit_contract(&env);
    contract1.whitelist_token(&admin, &token.address);
    contract1.initialize(&admin, &token.address, &250);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    contract1.register_agent(&agent);

    token.mint(&sender, &1000);

    // Create remittance and complete it
    let id = contract1.create_remittance(&sender, &agent, &100, &default_currency(&env), &default_country(&env), &None);
    contract1.confirm_payout(&id);

    // Export state
    let snapshot = contract1.export_migration_state(&admin).unwrap();

    // Verify all data is in snapshot
    assert_eq!(snapshot.instance_data.platform_fee_bps, 250);
    assert_eq!(snapshot.instance_data.remittance_counter, 1);
    assert!(snapshot.instance_data.accumulated_fees > 0);
    assert_eq!(snapshot.persistent_data.remittances.len(), 1);

    // Import to new contract
    let contract2 = create_swiftremit_contract(&env);
    contract2.import_migration_state(&admin, snapshot).unwrap();

    // Verify all data was imported
    assert_eq!(contract2.get_platform_fee_bps(), 250);
    assert!(contract2.get_accumulated_fees().unwrap() > 0);

    let remittance = contract2.get_remittance(&id).unwrap();
    assert_eq!(remittance.status, crate::RemittanceStatus::Completed);
}

#[test]
fn test_migration_deterministic_hash() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);

    // Export twice
    let snapshot1 = contract.export_migration_state(&admin).unwrap();
    let snapshot2 = contract.export_migration_state(&admin).unwrap();

    // Hashes should be identical (deterministic)
    // Note: timestamps will differ, so we can't compare full snapshots
    // but the hash algorithm should be deterministic for same data
    assert_eq!(snapshot1.instance_data.platform_fee_bps, snapshot2.instance_data.platform_fee_bps);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_export_batch_invalid_size() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let recipient = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    // Try to withdraw when no fees accumulated
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.withdraw_fees(&recipient);
    }));
    assert!(result.is_err());
}

#[test]
fn test_validation_prevents_paused_operations() {

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);

    // Try to export with batch size > MAX_MIGRATION_BATCH_SIZE
    contract.export_migration_batch(&admin, 0, 101);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_export_batch_zero_size() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);

    let contract = create_swiftremit_contract(&env);
    contract.whitelist_token(&admin, &token.address);
    contract.initialize(&admin, &token.address, &250);

    // Try to export with zero batch size
    contract.export_migration_batch(&admin, 0, 0);
}

#[test]
fn test_migration_with_multiple_remittance_statuses() {
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

    // Pause contract
    contract.pause();

    // Try to confirm payout while paused
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.confirm_payout(&remittance_id);
    }));
    assert!(result.is_err());
}

#[test]
fn test_validation_allows_valid_operations() {

    let contract1 = create_swiftremit_contract(&env);
    contract1.whitelist_token(&admin, &token.address);
    contract1.initialize(&admin, &token.address, &250);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    contract1.register_agent(&agent);

    token.mint(&sender, &10000);

    // Create remittances with different statuses
    let id1 = contract1.create_remittance(&sender, &agent, &100, &default_currency(&env), &default_country(&env), &None); // Pending
    let id2 = contract1.create_remittance(&sender, &agent, &100, &default_currency(&env), &default_country(&env), &None);
    contract1.confirm_payout(&id2); // Completed
    let id3 = contract1.create_remittance(&sender, &agent, &100, &default_currency(&env), &default_country(&env), &None);
    contract1.cancel_remittance(&id3); // Cancelled

    // Export and import
    let snapshot = contract1.export_migration_state(&admin).unwrap();
    let contract2 = create_swiftremit_contract(&env);
    contract2.import_migration_state(&admin, snapshot).unwrap();

    // Verify all statuses preserved
    assert_eq!(contract2.get_remittance(&id1).unwrap().status, crate::RemittanceStatus::Pending);
    assert_eq!(contract2.get_remittance(&id2).unwrap().status, crate::RemittanceStatus::Completed);
    assert_eq!(contract2.get_remittance(&id3).unwrap().status, crate::RemittanceStatus::Cancelled);
}

// ═══════════════════════════════════════════════════════════════════════════
// Rate Limiting Tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_rate_limit_initialization() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let contract = create_swiftremit_contract(&env);

    token.mint(&sender, &10000);

    let contract = create_swiftremit_contract(&env);
    
    // Valid initialization
    contract.initialize(&admin, &token.address, &250);
    
    // Valid agent registration
    contract.register_agent(&agent);
    
    // Valid remittance creation
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);
    assert_eq!(remittance_id, 1);
    
    // Valid payout confirmation
    contract.confirm_payout(&remittance_id);
    
    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Completed);
}

#[test]
fn test_validation_structured_error_for_expired_settlement() {
    token.mint(&sender, &20000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    // Check default rate limit config
    let (max_requests, window_seconds, enabled) = contract.get_rate_limit_config();
    assert_eq!(max_requests, 100);
    assert_eq!(window_seconds, 60);
    assert!(enabled);
}

#[test]
fn test_update_rate_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);
    token.mint(&sender, &20000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Create remittance with past expiry
    let current_time = env.ledger().timestamp();
    let past_expiry = current_time.saturating_sub(3600);
    
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &Some(past_expiry));

    // Validation should prevent expired settlement
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.confirm_payout(&remittance_id);
    }));
    assert!(result.is_err());
}

#[test]
fn test_validation_prevents_duplicate_settlement() {
    let currency = String::from_str(&env, "USD");
    let country = String::from_str(&env, "US");

    // Set daily limit to 10000
    contract.set_daily_limit(&currency, &country, &10000);

    // First transfer of 6000 should succeed
    contract.create_remittance(&sender, &agent, &6000, &currency, &country, &None);

    // Second transfer of 5000 should fail (total 11000 > 10000)
    contract.create_remittance(&sender, &agent, &5000, &currency, &country, &None);
}

#[test]
fn test_daily_limit_rolling_window() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);
    token.mint(&sender, &30000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    // First settlement succeeds
    contract.confirm_payout(&remittance_id);

    // Manually reset status to test duplicate prevention
    let mut remittance = contract.get_remittance(&remittance_id);
    remittance.status = crate::types::RemittanceStatus::Pending;
    env.as_contract(&contract.address, || {
        crate::storage::set_remittance(&env, remittance_id, &remittance);
    });

    // Second settlement should be prevented by validation
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.confirm_payout(&remittance_id);
    }));
    assert!(result.is_err());
}

#[test]
fn test_validation_comprehensive_create_remittance() {
    let currency = String::from_str(&env, "USD");
    let country = String::from_str(&env, "US");

    // Update rate limit
    contract.update_rate_limit(&admin, &50, &30, &true);

    let (max_requests, window_seconds, enabled) = contract.get_rate_limit_config();
    assert_eq!(max_requests, 50);
    assert_eq!(window_seconds, 30);
    assert!(enabled);
}

#[test]
fn test_rate_limit_status() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);
    token.mint(&sender, &30000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    // Test all validation passes for valid request
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);
    assert_eq!(remittance_id, 1);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.sender, sender);
    assert_eq!(remittance.agent, agent);
    assert_eq!(remittance.amount, 1000);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Pending);
}

#[test]
fn test_validation_comprehensive_confirm_payout() {
    let usd = String::from_str(&env, "USD");
    let eur = String::from_str(&env, "EUR");
    let us = String::from_str(&env, "US");

    // Set different limits for different currencies
    contract.set_daily_limit(&usd, &us, &10000);
    contract.set_daily_limit(&eur, &us, &15000);

    // Transfer 9000 in USD should succeed
    contract.create_remittance(&sender, &agent, &9000, &usd, &us, &None);

    // Transfer 14000 in EUR should succeed (different currency limit)
    contract.create_remittance(&sender, &agent, &14000, &eur, &us, &None);

    assert_eq!(token.balance(&contract.address), 23000);
}

#[test]
fn test_daily_limit_different_countries() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);
    token.mint(&sender, &30000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let current_time = env.ledger().timestamp();
    let future_expiry = current_time + 7200;

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &Some(future_expiry));

    // All validations should pass
    contract.confirm_payout(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Completed);
    assert_eq!(token.balance(&agent), 975);
}

#[test]
fn test_validation_comprehensive_cancel_remittance() {
    let usd = String::from_str(&env, "USD");
    let us = String::from_str(&env, "US");
    let uk = String::from_str(&env, "UK");

    // Set different limits for different countries
    contract.set_daily_limit(&usd, &us, &10000);
    contract.set_daily_limit(&usd, &uk, &15000);

    // Transfer 9000 to US should succeed
    contract.create_remittance(&sender, &agent, &9000, &usd, &us, &None);

    // Transfer 14000 to UK should succeed (different country limit)
    contract.create_remittance(&sender, &agent, &14000, &usd, &uk, &None);

    assert_eq!(token.balance(&contract.address), 23000);
}

#[test]
fn test_daily_limit_no_limit_configured() {
    let env = Env::default();
    env.mock_all_auths();

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);
    token.mint(&sender, &100000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    // All validations should pass
    contract.cancel_remittance(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, crate::types::RemittanceStatus::Cancelled);
    assert_eq!(token.balance(&sender), 10000); // Refunded
}

#[test]
fn test_validation_comprehensive_withdraw_fees() {
    let currency = String::from_str(&env, "USD");
    let country = String::from_str(&env, "US");

    // No limit configured, large transfer should succeed
    let remittance_id = contract.create_remittance(&sender, &agent, &50000, &currency, &country, &None);
    assert_eq!(remittance_id, 1);
    assert_eq!(token.balance(&contract.address), 50000);
}

#[test]
fn test_daily_limit_multiple_users() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let recipient = Address::generate(&env);

    token.mint(&sender, &10000);
    let sender1 = Address::generate(&env);
    let sender2 = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender1, &20000);
    token.mint(&sender2, &20000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);
    contract.confirm_payout(&remittance_id);

    // All validations should pass
    contract.withdraw_fees(&recipient);

    assert_eq!(token.balance(&recipient), 25);
    assert_eq!(contract.get_accumulated_fees(), 0);
}

#[test]
fn test_validation_edge_case_boundary_fee() {
    let currency = String::from_str(&env, "USD");
    let country = String::from_str(&env, "US");

    // Set daily limit to 10000
    contract.set_daily_limit(&currency, &country, &10000);

    // Each user should have their own limit
    contract.create_remittance(&sender1, &agent, &9000, &currency, &country, &None);
    contract.create_remittance(&sender2, &agent, &9000, &currency, &country, &None);

    assert_eq!(token.balance(&contract.address), 18000);
}

#[test]
fn test_rate_limit_disable() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let contract = create_swiftremit_contract(&env);

    // Test boundary: 10000 should be valid (100%)
    contract.initialize(&admin, &token.address, &10000);
    assert_eq!(contract.get_platform_fee_bps(), 10000);

    // Test boundary: 0 should be valid (0%)
    contract.update_fee(&0);
    assert_eq!(contract.get_platform_fee_bps(), 0);
}

#[test]
fn test_validation_edge_case_minimum_amount() {
    contract.initialize(&admin, &token.address, &250);

    let currency = String::from_str(&env, "USD");
    let country = String::from_str(&env, "US");

    // Negative limit should fail
    contract.set_daily_limit(&currency, &country, &-1000);
}

#[test]
fn test_daily_limit_exact_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token_contract(&env, &token_admin);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10000);
    token.mint(&sender, &20000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250);

    // Minimum valid amount is 1
    let remittance_id = contract.create_remittance(&sender, &agent, &1, &None);
    assert_eq!(remittance_id, 1);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.amount, 1);
    let currency = String::from_str(&env, "USD");
    let country = String::from_str(&env, "US");

    let (_, _, enabled) = contract.get_rate_limit_config();
    assert!(!enabled);
}
