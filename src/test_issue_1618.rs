//! Regression test for #1618: cancel_remittance must refund in the
//! remittance's own token, not always in USDC.

#![cfg(test)]

use crate::{SwiftRemitContract, SwiftRemitContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env};

fn make_token(env: &Env, admin: &Address) -> token::StellarAssetClient<'static> {
    let addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    token::StellarAssetClient::new(env, &addr)
}

fn balance(env: &Env, tok: &token::StellarAssetClient, addr: &Address) -> i128 {
    token::Client::new(env, &tok.address).balance(addr)
}

#[test]
fn test_1618_cancel_refunds_in_remittance_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    let usdc = make_token(&env, &admin);
    let other = make_token(&env, &admin);
    usdc.mint(&sender, &10_000);
    other.mint(&sender, &10_000);

    let contract =
        SwiftRemitContractClient::new(&env, &env.register_contract(None, SwiftRemitContract {}));
    contract.initialize(&admin, &usdc.address, &0u32, &0u64, &0u32, &admin);
    contract.register_agent(&agent, &None);
    contract.add_whitelisted_token(&other.address);

    let id = contract.create_remittance(
        &sender,
        &agent,
        &1_000,
        &None,
        &Some(other.address.clone()),
        &None,
        &None,
        &None,
        &None,
    );

    assert_eq!(balance(&env, &other, &sender), 9_000);
    assert_eq!(balance(&env, &usdc, &sender), 10_000);

    contract.cancel_remittance(&id);

    // Refunded in the remittance's own token.
    assert_eq!(balance(&env, &other, &sender), 10_000);
    // USDC untouched.
    assert_eq!(balance(&env, &usdc, &sender), 10_000);
}
