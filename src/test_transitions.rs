#![cfg(test)]

use crate::{SwiftRemitContract, SwiftRemitContractClient, RemittanceStatus};
use soroban_sdk::{testutils::Address as _, token, Address, Env};

fn create_token_contract<'a>(env: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    let contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    token::StellarAssetClient::new(env, &contract_id.address())
}

fn create_swiftremit_contract<'a>(env: &Env) -> SwiftRemitContractClient<'a> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

fn setup_contract(
    env: &Env,
) -> (
    SwiftRemitContractClient,
    token::StellarAssetClient,
    Address,
    Address,
    Address,
) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = create_token_contract(env, &token_admin);
    let agent = Address::generate(env);
    let sender = Address::generate(env);

    let contract = create_swiftremit_contract(env);

    env.mock_all_auths();
    contract.initialize(&admin, &token.address, &250, &0, &0, &admin);
    contract.register_agent(&agent);

    token.mint(&sender, &10000);

    (contract, token, admin, agent, sender)
}

#[test]
fn test_lifecycle_pending_to_completed() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup_contract(&env);

    env.mock_all_auths();
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, RemittanceStatus::Pending);

    contract.confirm_payout(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, RemittanceStatus::Completed);
}

#[test]
fn test_lifecycle_pending_to_cancelled() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup_contract(&env);

    env.mock_all_auths();
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, RemittanceStatus::Pending);

    contract.cancel_remittance(&remittance_id);

    let remittance = contract.get_remittance(&remittance_id);
    assert_eq!(remittance.status, RemittanceStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_invalid_transition_cancel_after_completed() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup_contract(&env);

    env.mock_all_auths();
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    contract.confirm_payout(&remittance_id);
    contract.cancel_remittance(&remittance_id);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_invalid_transition_confirm_after_cancelled() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup_contract(&env);

    env.mock_all_auths();
    let remittance_id = contract.create_remittance(&sender, &agent, &1000, &None);

    contract.cancel_remittance(&remittance_id);
    contract.confirm_payout(&remittance_id);
}

#[test]
fn test_multiple_remittances_independent_lifecycles() {
    let env = Env::default();
    let (contract, _token, _admin, agent, sender) = setup_contract(&env);

    env.mock_all_auths();

    let remittance_id_1 = contract.create_remittance(&sender, &agent, &1000, &None);
    let remittance_id_2 = contract.create_remittance(&sender, &agent, &2000, &None);

    contract.confirm_payout(&remittance_id_1);
    contract.cancel_remittance(&remittance_id_2);

    let remittance_1 = contract.get_remittance(&remittance_id_1);
    let remittance_2 = contract.get_remittance(&remittance_id_2);

    assert_eq!(remittance_1.status, RemittanceStatus::Completed);
    assert_eq!(remittance_2.status, RemittanceStatus::Cancelled);
}
