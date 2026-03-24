#![cfg(test)]
use crate::{SwiftRemitContract, SwiftRemitContractClient, EscrowStatus};
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Events},
    token, Address, Env, IntoVal, Symbol, TryFromVal,
};

fn create_token_contract<'a>(env: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    token::StellarAssetClient::new(env, &env.register_stellar_asset_contract_v2(admin.clone()).address())
}

fn create_swiftremit_contract<'a>(env: &Env) -> SwiftRemitContractClient<'a> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

fn token_balance(token: &token::StellarAssetClient, address: &Address) -> i128 {
    token::Client::new(&token.env, &token.address).balance(address)
}

#[test]
fn test_create_escrow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);

    assert_eq!(transfer_id, 1);
    assert_eq!(token_balance(&token, &sender), 500);
    assert_eq!(token_balance(&token, &contract.address), 500);

    let escrow = contract.get_escrow(&transfer_id);
    assert_eq!(escrow.sender, sender);
    assert_eq!(escrow.recipient, recipient);
    assert_eq!(escrow.amount, 500);
    assert_eq!(escrow.status, EscrowStatus::Pending);
}

#[test]
fn test_release_escrow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);
    contract.release_escrow(&transfer_id);

    let escrow = contract.get_escrow(&transfer_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
    assert_eq!(token_balance(&token, &recipient), 500);
    assert_eq!(token_balance(&token, &contract.address), 0);
}

#[test]
fn test_refund_escrow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);
    contract.refund_escrow(&transfer_id);

    let escrow = contract.get_escrow(&transfer_id);
    assert_eq!(escrow.status, EscrowStatus::Refunded);
    assert_eq!(token_balance(&token, &sender), 1000);
    assert_eq!(token_balance(&token, &contract.address), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #39)")]
fn test_double_release_prevented() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);
    contract.release_escrow(&transfer_id);
    contract.release_escrow(&transfer_id); // Should panic
}

#[test]
#[should_panic(expected = "Error(Contract, #39)")]
fn test_double_refund_prevented() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);
    contract.refund_escrow(&transfer_id);
    contract.refund_escrow(&transfer_id); // Should panic
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_create_escrow_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    contract.create_escrow(&sender, &recipient, &0);
}

#[test]
fn test_escrow_events_emitted() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);
    
    let events = env.events().all();
    let create_event = events.iter().find(|e| {
        let topic0 = e.1.get(0).and_then(|t| Symbol::try_from_val(&env, &t).ok());
        let topic1 = e.1.get(1).and_then(|t| Symbol::try_from_val(&env, &t).ok());
        topic0 == Some(Symbol::new(&env, "escrow"))
            && topic1 == Some(Symbol::new(&env, "created"))
    });
    assert!(create_event.is_some());

    contract.release_escrow(&transfer_id);
    
    let events = env.events().all();
    let release_event = events.iter().find(|e| {
        let topic0 = e.1.get(0).and_then(|t| Symbol::try_from_val(&env, &t).ok());
        let topic1 = e.1.get(1).and_then(|t| Symbol::try_from_val(&env, &t).ok());
        topic0 == Some(Symbol::new(&env, "escrow"))
            && topic1 == Some(Symbol::new(&env, "released"))
    });
    assert!(release_event.is_some());
}
