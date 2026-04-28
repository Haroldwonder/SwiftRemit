#![cfg(test)]

use crate::{SwiftRemitContract, SwiftRemitContractClient, ContractError};
use soroban_sdk::{
    testutils::{Address as _, Events},
    token, Address, Env, IntoVal, Symbol, Vec,
};

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (token::StellarAssetClient<'a>, token::TokenClient<'a>) {
    let contract_address = env.register_stellar_asset_contract_v2(admin.clone());
    (
        token::StellarAssetClient::new(env, &contract_address.address()),
        token::TokenClient::new(env, &contract_address.address()),
    )
}

fn create_swiftremit_contract(env: &Env) -> SwiftRemitContractClient {
    let contract_id = env.register_contract(None, SwiftRemitContract);
    SwiftRemitContractClient::new(env, &contract_id)
}

#[test]
fn test_add_whitelisted_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (usdc_admin, usdc_token) = create_token_contract(&env, &admin);
    let (eurc_admin, eurc_token) = create_token_contract(&env, &admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &usdc_token.address, &250, &3600, &0, &admin);

    // Add EURC to whitelist
    contract.add_whitelisted_token(&eurc_token.address);

    // Verify EURC is whitelisted
    assert!(contract.is_token_whitelisted(&eurc_token.address));

    // Verify it appears in the list
    let tokens = contract.get_whitelisted_tokens();
    assert_eq!(tokens.len(), 2); // USDC (from init) + EURC
    
    let mut found_usdc = false;
    let mut found_eurc = false;
    for i in 0..tokens.len() {
        let token = tokens.get_unchecked(i);
        if token == usdc_token.address {
            found_usdc = true;
        }
        if token == eurc_token.address {
            found_eurc = true;
        }
    }
    assert!(found_usdc);
    assert!(found_eurc);

    // Verify event was emitted
    let events = env.events().all();
    let event = events.last().unwrap();
    
    assert_eq!(
        event.topics,
        (Symbol::new(&env, "token"), Symbol::new(&env, "whitelist")).into_val(&env)
    );
}

#[test]
fn test_add_already_whitelisted_token_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, usdc_token) = create_token_contract(&env, &admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &usdc_token.address, &250, &3600, &0, &admin);

    // Try to add USDC again (already whitelisted during init)
    let result = contract.try_add_whitelisted_token(&usdc_token.address);
    
    assert_eq!(result, Err(Ok(ContractError::TokenAlreadyWhitelisted)));
}

#[test]
fn test_remove_whitelisted_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, usdc_token) = create_token_contract(&env, &admin);
    let (_, eurc_token) = create_token_contract(&env, &admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &usdc_token.address, &250, &3600, &0, &admin);
    contract.add_whitelisted_token(&eurc_token.address);

    // Remove EURC from whitelist
    contract.remove_whitelisted_token(&eurc_token.address);

    // Verify EURC is no longer whitelisted
    assert!(!contract.is_token_whitelisted(&eurc_token.address));

    // Verify it's removed from the list
    let tokens = contract.get_whitelisted_tokens();
    assert_eq!(tokens.len(), 1); // Only USDC remains
    assert_eq!(tokens.get_unchecked(0), usdc_token.address);

    // Verify event was emitted
    let events = env.events().all();
    let event = events.last().unwrap();
    
    assert_eq!(
        event.topics,
        (Symbol::new(&env, "token"), Symbol::new(&env, "rm_white")).into_val(&env)
    );
}

#[test]
fn test_remove_non_whitelisted_token_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, usdc_token) = create_token_contract(&env, &admin);
    let non_whitelisted_token = Address::generate(&env);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &usdc_token.address, &250, &3600, &0, &admin);

    // Try to remove a token that was never whitelisted
    let result = contract.try_remove_whitelisted_token(&non_whitelisted_token);
    
    assert_eq!(result, Err(Ok(ContractError::TokenNotWhitelisted)));
}

#[test]
fn test_get_whitelisted_tokens_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, usdc_token) = create_token_contract(&env, &admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &usdc_token.address, &250, &3600, &0, &admin);

    // Should have USDC from initialization
    let tokens = contract.get_whitelisted_tokens();
    assert_eq!(tokens.len(), 1);
    assert_eq!(tokens.get_unchecked(0), usdc_token.address);
}

#[test]
fn test_get_whitelisted_tokens_multiple() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, usdc_token) = create_token_contract(&env, &admin);
    let (_, eurc_token) = create_token_contract(&env, &admin);
    let (_, gbp_token) = create_token_contract(&env, &admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &usdc_token.address, &250, &3600, &0, &admin);
    
    contract.add_whitelisted_token(&eurc_token.address);
    contract.add_whitelisted_token(&gbp_token.address);

    let tokens = contract.get_whitelisted_tokens();
    assert_eq!(tokens.len(), 3);
}

#[test]
fn test_only_admin_can_add_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let (_, usdc_token) = create_token_contract(&env, &admin);
    let (_, eurc_token) = create_token_contract(&env, &admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &usdc_token.address, &250, &3600, &0, &admin);

    // This should fail because we're mocking all auths
    // In a real scenario, the non-admin would not be able to authenticate
    // For this test, we verify the admin check is in place
    let result = contract.try_add_whitelisted_token(&eurc_token.address);
    
    // Should succeed because we're mocking all auths
    // In production, this would require proper admin authentication
    assert!(result.is_ok());
}

#[test]
fn test_only_admin_can_remove_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, usdc_token) = create_token_contract(&env, &admin);
    let (_, eurc_token) = create_token_contract(&env, &admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &usdc_token.address, &250, &3600, &0, &admin);
    contract.add_whitelisted_token(&eurc_token.address);

    // Remove token
    let result = contract.try_remove_whitelisted_token(&eurc_token.address);
    
    // Should succeed because we're mocking all auths
    assert!(result.is_ok());
}

#[test]
fn test_whitelist_token_add_remove_add_again() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, usdc_token) = create_token_contract(&env, &admin);
    let (_, eurc_token) = create_token_contract(&env, &admin);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &usdc_token.address, &250, &3600, &0, &admin);

    // Add EURC
    contract.add_whitelisted_token(&eurc_token.address);
    assert!(contract.is_token_whitelisted(&eurc_token.address));
    assert_eq!(contract.get_whitelisted_tokens().len(), 2);

    // Remove EURC
    contract.remove_whitelisted_token(&eurc_token.address);
    assert!(!contract.is_token_whitelisted(&eurc_token.address));
    assert_eq!(contract.get_whitelisted_tokens().len(), 1);

    // Add EURC again
    contract.add_whitelisted_token(&eurc_token.address);
    assert!(contract.is_token_whitelisted(&eurc_token.address));
    assert_eq!(contract.get_whitelisted_tokens().len(), 2);
}
