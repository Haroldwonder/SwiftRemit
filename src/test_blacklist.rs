#![cfg(test)]
extern crate std;

use crate::{set_admin_role, ContractError, SwiftRemitContract, SwiftRemitContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events},
    token, Address, Env, Symbol,
};

/// Check if any emitted event has the given two symbol topics.
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

fn setup<'a>(
    env: &'a Env,
) -> (
    SwiftRemitContractClient<'a>,
    Address,
    token::StellarAssetClient<'a>,
) {
    let admin = Address::generate(env);
    let token_client = token::StellarAssetClient::new(
        env,
        &env.register_stellar_asset_contract_v2(admin.clone())
            .address(),
    );
    let contract =
        SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}));
    contract.initialize(&admin, &token_client.address, &250, &0, &0, &admin);
    (contract, admin, token_client)
}

#[test]
fn test_blacklist_user_requires_admin_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let user = Address::generate(&env);

    contract.blacklist_user(&user);

    assert!(contract.is_user_blacklisted(&user));
    assert_eq!(env.auths().len(), 1);
    assert_eq!(env.auths()[0].0, admin);
}

#[test]
fn test_blacklisted_sender_cannot_create_remittance() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _admin, token) = setup(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10_000);
    contract.register_agent(&agent, &None);
    contract.blacklist_user(&sender);

    let result = contract.try_create_remittance(&sender, &agent, &1_000, &None, &None, &None, &None, &None);
    assert_eq!(result, Err(Ok(ContractError::UserBlacklisted)));
}

#[test]
fn test_remove_from_blacklist_allows_remittance_again() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, token) = setup(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10_000);
    contract.register_agent(&agent, &None);
    contract.blacklist_user(&sender);
    contract.remove_from_blacklist(&sender);

    assert_eq!(env.auths().len(), 1);
    assert_eq!(env.auths()[0].0, admin);

    let remittance_id = contract.create_remittance(&sender, &agent, &1_000, &None, &None, &None, &None, &None);
    let remittance = contract.get_remittance(&remittance_id);

    assert_eq!(remittance.sender, sender);
    assert_eq!(env.auths().len(), 1);
    assert_eq!(env.auths()[0].0, sender);

    let events = env.events().all();
    let added = has_event(&env, "blacklist", "added");
    let removed = has_event(&env, "blacklist", "removed");
    let _ = events;

    assert!(added, "blacklist added event was not emitted");
    assert!(removed, "blacklist removed event was not emitted");
}

#[test]
fn test_pause_requires_admin_authorization() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    set_admin_role(&env, &admin, false);

    let result = contract.try_pause();
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

#[test]
fn test_pause_unpause_updates_state_and_emits_events() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    contract.pause();

    assert!(contract.is_paused());
    assert_eq!(env.auths().len(), 1);
    assert_eq!(env.auths()[0].0, admin);

    contract.unpause();

    assert!(!contract.is_paused());
    assert_eq!(env.auths().len(), 1);
    assert_eq!(env.auths()[0].0, admin);

    let paused = has_event(&env, "admin", "paused");
    let unpaused = has_event(&env, "admin", "unpaused");

    assert!(paused, "paused event was not emitted");
    assert!(unpaused, "unpaused event was not emitted");
}

#[test]
fn test_confirm_payout_blocked_while_paused_and_allowed_after_unpause() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _admin, token) = setup(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10_000);
    contract.register_agent(&agent, &None);

    let remittance_id = contract.create_remittance(&sender, &agent, &1_000, &None, &None, &None, &None, &None);

    contract.pause();

    let paused_result = contract.try_confirm_payout(&remittance_id, &None, &None);
    assert_eq!(paused_result, Err(Ok(ContractError::ContractPaused)));

    contract.unpause();
    contract.confirm_payout(&remittance_id, &None, &None);
}
