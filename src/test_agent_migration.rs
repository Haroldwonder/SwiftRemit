//! Tests for agent registration storage key migration.

#![cfg(test)]

use crate::{
    migration::{migrate, rollback_migration, CURRENT_SCHEMA_VERSION},
    ContractError, SwiftRemitContract, SwiftRemitContractClient,
};
use soroban_sdk::{testutils::Address as _, token, Address, Env};

fn create_token<'a>(env: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    token::StellarAssetClient::new(
        env,
        &env.register_stellar_asset_contract_v2(admin.clone()).address(),
    )
}

fn setup(env: &Env) -> (SwiftRemitContractClient, Address, token::StellarAssetClient) {
    let admin = Address::generate(env);
    let token = create_token(env, &admin);
    let contract = SwiftRemitContractClient::new(
        env,
        &env.register_contract(None, SwiftRemitContract {}),
    );
    contract.initialize(&admin, &token.address, &250, &0, &0, &admin);
    (contract, admin, token)
}

#[test]
fn test_migrate_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _admin, _token) = setup(&env);
    let agent1 = Address::generate(&env);
    let agent2 = Address::generate(&env);
    contract.register_agent(&agent1, &None);
    contract.register_agent(&agent2, &None);

    // Call migrate directly via env.as_contract
    env.as_contract(&contract.address, || {
        migrate(&env).unwrap();
        migrate(&env).unwrap(); // idempotent
    });

    assert!(contract.is_agent_registered(&agent1));
    assert!(contract.is_agent_registered(&agent2));
}

#[test]
fn test_migrate_preserves_agent_registration() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _admin, _token) = setup(&env);
    let agent = Address::generate(&env);
    contract.register_agent(&agent, &None);

    env.as_contract(&contract.address, || {
        migrate(&env).unwrap();
    });

    assert!(contract.is_agent_registered(&agent));
}

#[test]
fn test_rollback_without_snapshot_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _admin, _token) = setup(&env);
    let agent = Address::generate(&env);
    contract.register_agent(&agent, &None);

    // Rollback with no snapshot should fail
    let result = env.as_contract(&contract.address, || rollback_migration(&env));
    assert!(result.is_err());

    // Agent still registered
    assert!(contract.is_agent_registered(&agent));
}

#[test]
fn test_agent_registration_and_removal() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _admin, _token) = setup(&env);
    let agent = Address::generate(&env);

    assert!(!contract.is_agent_registered(&agent));
    contract.register_agent(&agent, &None);
    assert!(contract.is_agent_registered(&agent));
    contract.remove_agent(&agent);
    assert!(!contract.is_agent_registered(&agent));
}

#[test]
fn test_schema_version_is_current() {
    assert!(CURRENT_SCHEMA_VERSION >= 1);
}
