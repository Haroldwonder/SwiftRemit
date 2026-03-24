#![cfg(test)]

use crate::{ContractError, SwiftRemitContract};
use soroban_sdk::{testutils::Address as _, Address, Env};

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
