#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{health::health, SwiftRemitContract};

fn setup_env() -> (Env, soroban_sdk::Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SwiftRemitContract {});
    (env, contract_id)
}

#[test]
fn test_health_uninitialized() {
    let (env, contract_id) = setup_env();
    env.as_contract(&contract_id, || {
        let status = health(&env);
        assert!(!status.initialized);
        assert!(!status.paused);
        assert_eq!(status.admin_count, 0);
        assert_eq!(status.total_remittances, 0);
        assert_eq!(status.accumulated_fees, 0);
    });
}

#[test]
fn test_health_after_initialize() {
    let (env, contract_id) = setup_env();
    let admin = Address::generate(&env);
    let usdc = env.register_contract(None, SwiftRemitContract {});
    let treasury = Address::generate(&env);

    SwiftRemitContract::initialize(
        env.clone(),
        admin.clone(),
        usdc,
        250,
        0,
        0,
        treasury,
    )
    .unwrap();

    env.as_contract(&contract_id, || {
        let status = health(&env);
        assert!(status.initialized);
        assert!(!status.paused);
        assert_eq!(status.admin_count, 1);
        assert_eq!(status.total_remittances, 0);
        assert_eq!(status.accumulated_fees, 0);
    });
}

#[test]
fn test_health_reflects_paused_state() {
    let (env, contract_id) = setup_env();
    let admin = Address::generate(&env);
    let usdc = env.register_contract(None, SwiftRemitContract {});
    let treasury = Address::generate(&env);

    SwiftRemitContract::initialize(
        env.clone(),
        admin.clone(),
        usdc,
        250,
        0,
        0,
        treasury,
    )
    .unwrap();

    SwiftRemitContract::pause(env.clone()).unwrap();

    env.as_contract(&contract_id, || {
        let status = health(&env);
        assert!(status.paused);
    });
}
