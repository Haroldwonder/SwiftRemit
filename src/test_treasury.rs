#![cfg(test)]
extern crate std;

use crate::{ContractError, SwiftRemitContract, SwiftRemitContractClient};
use soroban_sdk::{symbol_short, testutils::{Address as _, Events}, token, Address, Env};

fn has_event(env: &Env, t0: &str, t1: &str) -> bool {
    use soroban_sdk::xdr::{ContractEventBody, ScVal, ScSymbol, StringM};
    let sym0 = ScVal::Symbol(ScSymbol(StringM::try_from(t0).unwrap()));
    let sym1 = ScVal::Symbol(ScSymbol(StringM::try_from(t1).unwrap()));
    env.events().all().events().iter().any(|e| {
        if let ContractEventBody::V0(body) = &e.body {
            body.topics.len() >= 2 && body.topics[0] == sym0 && body.topics[1] == sym1
        } else {
            false
        }
    })
}

fn setup<'a>(env: &'a Env) -> (SwiftRemitContractClient<'a>, Address) {
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
    (contract, admin)
}

#[test]
fn test_update_treasury_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin) = setup(&env);
    let new_treasury = Address::generate(&env);

    contract.update_treasury(&admin, &new_treasury);

    assert_eq!(contract.get_treasury(), new_treasury);
}

#[test]
fn test_update_treasury_replaces_old_address() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin) = setup(&env);
    let treasury_v2 = Address::generate(&env);
    let treasury_v3 = Address::generate(&env);

    contract.update_treasury(&admin, &treasury_v2);
    assert_eq!(contract.get_treasury(), treasury_v2);

    contract.update_treasury(&admin, &treasury_v3);
    assert_eq!(contract.get_treasury(), treasury_v3);
}

#[test]
fn test_update_treasury_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _admin) = setup(&env);
    let non_admin = Address::generate(&env);
    let new_treasury = Address::generate(&env);

    let result = contract.try_update_treasury(&non_admin, &new_treasury);
    assert!(result.is_err());
}

#[test]
fn test_update_treasury_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin) = setup(&env);
    let new_treasury = Address::generate(&env);

    contract.update_treasury(&admin, &new_treasury);

    let found = has_event(&env, "treasury", "upd");
    assert!(found, "treasury_upd event was not emitted");
}

fn fund_fees(env: &Env, contract: &SwiftRemitContractClient, token_client: &token::StellarAssetClient, amount: i128) {
    // Seed the contract with fees by transferring tokens directly and
    // recording them through the contract's fee accounting path.
    token_client.mint(&contract.address, &amount);
    contract.record_fees(&amount);
}

#[test]
fn test_withdraw_fees_partial() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin) = setup(&env);
    let token_client = token::StellarAssetClient::new(&env, &contract.get_token());
    let to = Address::generate(&env);

    fund_fees(&env, &contract, &token_client, 1000);
    assert_eq!(contract.get_accumulated_fees(), 1000);

    contract.withdraw_fees(&admin, &to, &Some(400));

    assert_eq!(contract.get_accumulated_fees(), 600);
    assert_eq!(token_client.balance(&to), 400);

    let found = has_event(&env, "fees", "wd");
    assert!(found, "fees_wd event was not emitted");
}

#[test]
fn test_withdraw_fees_full_via_some() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin) = setup(&env);
    let token_client = token::StellarAssetClient::new(&env, &contract.get_token());
    let to = Address::generate(&env);

    fund_fees(&env, &contract, &token_client, 1000);

    contract.withdraw_fees(&admin, &to, &Some(1000));

    assert_eq!(contract.get_accumulated_fees(), 0);
    assert_eq!(token_client.balance(&to), 1000);
}

#[test]
fn test_withdraw_fees_none_withdraws_all() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin) = setup(&env);
    let token_client = token::StellarAssetClient::new(&env, &contract.get_token());
    let to = Address::generate(&env);

    fund_fees(&env, &contract, &token_client, 750);

    contract.withdraw_fees(&admin, &to, &None);

    assert_eq!(contract.get_accumulated_fees(), 0);
    assert_eq!(token_client.balance(&to), 750);
}

#[test]
fn test_withdraw_fees_over_withdrawal_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin) = setup(&env);
    let token_client = token::StellarAssetClient::new(&env, &contract.get_token());
    let to = Address::generate(&env);

    fund_fees(&env, &contract, &token_client, 500);

    let result = contract.try_withdraw_fees(&admin, &to, &Some(501));
    assert_eq!(result, Err(Ok(ContractError::InvalidAmount)));
    assert_eq!(contract.get_accumulated_fees(), 500);
}

#[test]
fn test_withdraw_fees_zero_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin) = setup(&env);
    let token_client = token::StellarAssetClient::new(&env, &contract.get_token());
    let to = Address::generate(&env);

    fund_fees(&env, &contract, &token_client, 500);

    let result = contract.try_withdraw_fees(&admin, &to, &Some(0));
    assert_eq!(result, Err(Ok(ContractError::InvalidAmount)));
    assert_eq!(contract.get_accumulated_fees(), 500);
}

#[test]
fn test_withdraw_fees_negative_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin) = setup(&env);
    let token_client = token::StellarAssetClient::new(&env, &contract.get_token());
    let to = Address::generate(&env);

    fund_fees(&env, &contract, &token_client, 500);

    let result = contract.try_withdraw_fees(&admin, &to, &Some(-1));
    assert_eq!(result, Err(Ok(ContractError::InvalidAmount)));
    assert_eq!(contract.get_accumulated_fees(), 500);
}
