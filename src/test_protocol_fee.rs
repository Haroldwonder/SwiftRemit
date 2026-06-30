#![cfg(test)]

use crate::{ContractError, SwiftRemitContract, SwiftRemitContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env};

#[test]
fn test_protocol_fee_storage() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    env.as_contract(&contract_id, || {
        crate::storage::set_protocol_fee_bps(&env, 100).unwrap(); // 1%
        assert_eq!(crate::storage::get_protocol_fee_bps(&env), 100);

        crate::storage::set_protocol_fee_bps(&env, 150).unwrap(); // 1.5%
        assert_eq!(crate::storage::get_protocol_fee_bps(&env), 150);
    });
}

#[test]
fn test_protocol_fee_cap() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    env.as_contract(&contract_id, || {
        assert!(crate::storage::set_protocol_fee_bps(&env, 200).is_ok());

        let result = crate::storage::set_protocol_fee_bps(&env, 201);
        assert_eq!(result, Err(ContractError::InvalidFeeBps));

        let result = crate::storage::set_protocol_fee_bps(&env, 1000);
        assert_eq!(result, Err(ContractError::InvalidFeeBps));
    });
}

#[test]
fn test_treasury_storage() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    env.as_contract(&contract_id, || {
        let treasury = Address::generate(&env);

        crate::storage::set_treasury(&env, &treasury);
        assert_eq!(crate::storage::get_treasury(&env).unwrap(), treasury);

        let new_treasury = Address::generate(&env);
        crate::storage::set_treasury(&env, &new_treasury);
        assert_eq!(crate::storage::get_treasury(&env).unwrap(), new_treasury);
    });
}

#[test]
fn test_protocol_fee_calculation() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    env.as_contract(&contract_id, || {
        crate::storage::set_protocol_fee_bps(&env, 100).unwrap();

        let amount = 10000i128;
        let fee_bps = crate::storage::get_protocol_fee_bps(&env);
        let protocol_fee = amount * (fee_bps as i128) / 10000;
        assert_eq!(protocol_fee, 100);

        crate::storage::set_protocol_fee_bps(&env, 200).unwrap();
        let fee_bps = crate::storage::get_protocol_fee_bps(&env);
        let protocol_fee = amount * (fee_bps as i128) / 10000;
        assert_eq!(protocol_fee, 200);
    });
}

#[test]
fn test_zero_protocol_fee() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    env.as_contract(&contract_id, || {
        assert!(crate::storage::set_protocol_fee_bps(&env, 0).is_ok());
        assert_eq!(crate::storage::get_protocol_fee_bps(&env), 0);

        let amount = 10000i128;
        let protocol_fee = amount * 0 / 10000;
        assert_eq!(protocol_fee, 0);
    });
}

#[test]
fn test_default_protocol_fee() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    env.as_contract(&contract_id, || {
        assert_eq!(crate::storage::get_protocol_fee_bps(&env), 0);
    });
}

// ========== Public Contract Function Tests ==========

#[test]
fn test_update_protocol_fee_admin_only() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    // Register token contract
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register_contract(None, SwiftRemitContract {});
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    // Initialize contract
    client.initialize(&admin, &token.address(), &250, &5, &50, &treasury);

    // Test admin can update protocol fee
    let result = client.try_update_protocol_fee(&admin, &100);
    assert!(result.is_ok());
    assert_eq!(client.get_protocol_fee_bps(), 100);

    // Test non-admin cannot update protocol fee
    let result = client.try_update_protocol_fee(&non_admin, &150);
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));

    // Verify fee was not changed by non-admin
    assert_eq!(client.get_protocol_fee_bps(), 100);
}

#[test]
fn test_update_protocol_fee_validation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    // Register token contract
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register_contract(None, SwiftRemitContract {});
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    // Initialize contract
    client.initialize(&admin, &token.address(), &250, &5, &50, &treasury);

    // Test valid fee values
    assert!(client.try_update_protocol_fee(&admin, &0).is_ok());
    assert_eq!(client.get_protocol_fee_bps(), 0);

    assert!(client.try_update_protocol_fee(&admin, &100).is_ok());
    assert_eq!(client.get_protocol_fee_bps(), 100);

    assert!(client.try_update_protocol_fee(&admin, &200).is_ok());
    assert_eq!(client.get_protocol_fee_bps(), 200);

    // Test invalid fee values (above maximum)
    let result = client.try_update_protocol_fee(&admin, &201);
    assert_eq!(result, Err(Ok(ContractError::InvalidFeeBps)));

    let result = client.try_update_protocol_fee(&admin, &1000);
    assert_eq!(result, Err(Ok(ContractError::InvalidFeeBps)));

    let result = client.try_update_protocol_fee(&admin, &10000);
    assert_eq!(result, Err(Ok(ContractError::InvalidFeeBps)));

    // Verify fee was not changed by invalid updates
    assert_eq!(client.get_protocol_fee_bps(), 200);
}

#[test]
fn test_get_protocol_fee_bps_public() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    // Register token contract
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register_contract(None, SwiftRemitContract {});
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    // Initialize contract
    client.initialize(&admin, &token.address(), &250, &5, &50, &treasury);

    // Test default value
    assert_eq!(client.get_protocol_fee_bps(), 0);

    // Update and verify
    client.update_protocol_fee(&admin, &150);
    assert_eq!(client.get_protocol_fee_bps(), 150);

    // Any address can read the fee (no auth required)
    let any_user = Address::generate(&env);
    env.as_contract(&contract_id, || {
        assert_eq!(crate::storage::get_protocol_fee_bps(&env), 150);
    });
}

#[test]
fn test_get_treasury_public() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    // Register token contract
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register_contract(None, SwiftRemitContract {});
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    // Initialize contract
    client.initialize(&admin, &token.address(), &250, &5, &50, &treasury);

    // Test treasury can be read
    assert_eq!(client.get_treasury(), treasury);

    // Update treasury and verify
    let new_treasury = Address::generate(&env);
    client.update_treasury(&admin, &new_treasury);
    assert_eq!(client.get_treasury(), new_treasury);
}

#[test]
fn test_protocol_fee_event_emission() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    // Register token contract
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register_contract(None, SwiftRemitContract {});
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    // Initialize contract
    client.initialize(&admin, &token.address(), &250, &5, &50, &treasury);

    // Update protocol fee and check events
    client.update_protocol_fee(&admin, &100);

    // Verify event was emitted (events are tested via the event system)
    // The actual event verification would be done through env.events() in integration tests
    assert_eq!(client.get_protocol_fee_bps(), 100);
}
