#![cfg(test)]

use crate::{ContractError, SwiftRemitContract, SwiftRemitContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env};

fn setup<'a>(env: &'a Env) -> (SwiftRemitContractClient<'a>, token::StellarAssetClient<'a>) {
    let admin = Address::generate(env);
    let token_client = token::StellarAssetClient::new(
        env,
        &env.register_stellar_asset_contract_v2(admin.clone()).address(),
    );
    let contract = SwiftRemitContractClient::new(
        env,
        &env.register_contract(None, SwiftRemitContract {}),
    );
    contract.initialize(&admin, &token_client.address, &250, &0, &0, &admin);
    (contract, token_client)
}

#[test]
fn test_withdraw_integrator_fees_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, token) = setup(&env);
    let integrator = Address::generate(&env);
    let to = Address::generate(&env);

    token.mint(&contract.address, &500);
    env.as_contract(&contract.address, || {
        crate::storage::set_accumulated_integrator_fees(&env, 500);
    });

    contract.withdraw_integrator_fees(&integrator, &to);

    assert_eq!(contract.get_accumulated_integrator_fees(), 0);
    assert_eq!(token::Client::new(&env, &token.address).balance(&to), 500);
}

#[test]
fn test_withdraw_integrator_fees_no_fees_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token) = setup(&env);
    let integrator = Address::generate(&env);
    let to = Address::generate(&env);

    let result = contract.try_withdraw_integrator_fees(&integrator, &to);
    assert_eq!(result, Err(Ok(ContractError::NoFeesToWithdraw)));
}

#[test]
fn test_get_accumulated_integrator_fees_default_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token) = setup(&env);
    assert_eq!(contract.get_accumulated_integrator_fees(), 0);
}

#[test]
fn test_set_and_get_accumulated_integrator_fees() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    env.as_contract(&contract_id, || {
        crate::storage::set_accumulated_integrator_fees(&env, 1234);
        assert_eq!(crate::storage::get_accumulated_integrator_fees(&env), 1234);

        crate::storage::set_accumulated_integrator_fees(&env, 0);
        assert_eq!(crate::storage::get_accumulated_integrator_fees(&env), 0);
    });
}
