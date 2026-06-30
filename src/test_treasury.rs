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
