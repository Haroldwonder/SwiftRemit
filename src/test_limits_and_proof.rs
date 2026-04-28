#![cfg(test)]

use crate::{
    BatchSettlementEntry, ContractError, SettlementConfig, SwiftRemitContract,
    SwiftRemitContractClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String, Vec,
};

fn create_token_contract<'a>(env: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    let address = env.register_stellar_asset_contract_v2(admin.clone()).address();
    token::StellarAssetClient::new(env, &address)
}

fn create_swiftremit_contract<'a>(env: &'a Env) -> SwiftRemitContractClient<'a> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

fn setup(
    env: &Env,
) -> (
    SwiftRemitContractClient,
    token::StellarAssetClient,
    Address,
    Address,
    Address,
    Address,
) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = create_token_contract(env, &token_admin);
    let sender = Address::generate(env);
    let agent = Address::generate(env);

    token.mint(&sender, &500_000);

    let contract = create_swiftremit_contract(env);
    contract.initialize(&admin, &token.address, &250, &0, &0, &admin);
    contract.register_agent(&agent);

    (contract, token, admin, sender, agent, token_admin)
}

#[test]
fn test_set_daily_limit_and_enforcement() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, sender, agent, _token_admin) = setup(&env);

    let currency = String::from_str(&env, "USDC");
    let country = String::from_str(&env, "GLOBAL");

    contract.set_daily_limit(&currency, &country, &1000);

    let _id = contract.create_remittance(&sender, &agent, &600, &None, &None, &None);

    let result = contract.try_create_remittance(&sender, &agent, &500, &None, &None, &None);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::DailySendLimitExceeded);

    assert_eq!(contract.get_daily_limit(&currency, &country), Some(1000));
    let _ = admin;
}

#[test]
fn test_daily_limit_rolling_24h_window_resets() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, _admin, sender, agent, _token_admin) = setup(&env);

    let currency = String::from_str(&env, "USDC");
    let country = String::from_str(&env, "GLOBAL");
    contract.set_daily_limit(&currency, &country, &1000);

    let _id = contract.create_remittance(&sender, &agent, &800, &None, &None, &None);

    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 86_401;
    });

    // Window has rolled forward; this should succeed.
    let _id2 = contract.create_remittance(&sender, &agent, &800, &None, &None, &None);
}

#[test]
fn test_confirm_payout_valid_commitment_proof() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, sender, agent, _token_admin) = setup(&env);

    let config = SettlementConfig {
        require_proof: true,
        oracle_address: Some(admin.clone()),
    };

    let remittance_id = contract.create_remittance(
        &sender,
        &agent,
        &2_000,
        &None,
        &None,
        &Some(config),
    );

    let remittance = contract.get_remittance(&remittance_id);
    let proof = crate::verification::compute_payout_commitment(&env, &remittance);

    contract.confirm_payout(&remittance_id, &Some(proof));
}

#[test]
fn test_confirm_payout_invalid_commitment_proof() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, sender, agent, _token_admin) = setup(&env);

    let config = SettlementConfig {
        require_proof: true,
        oracle_address: Some(admin.clone()),
    };

    let remittance_id = contract.create_remittance(
        &sender,
        &agent,
        &2_000,
        &None,
        &None,
        &Some(config),
    );

    let bad_proof = soroban_sdk::BytesN::from_array(&env, &[7u8; 32]);
    let result = contract.try_confirm_payout(&remittance_id, &Some(bad_proof));
    assert_eq!(result.unwrap_err().unwrap(), ContractError::InvalidProof);
}

#[test]
fn test_confirm_payout_missing_required_proof() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, sender, agent, _token_admin) = setup(&env);

    let config = SettlementConfig {
        require_proof: true,
        oracle_address: Some(admin.clone()),
    };

    let remittance_id = contract.create_remittance(
        &sender,
        &agent,
        &2_000,
        &None,
        &None,
        &Some(config),
    );

    let result = contract.try_confirm_payout(&remittance_id, &None);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::MissingProof);
}

#[test]
fn test_public_get_rate_limit_status_within_and_across_windows() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, _admin, sender, _agent, _token_admin) = setup(&env);

    // Callable as a public read method.
    let initial = contract.get_rate_limit_status(&sender);
    assert_eq!(initial, (0, 100, 60));

    // Simulate requests inside the same window.
    env.as_contract(&contract.address, || {
        crate::rate_limit::check_rate_limit(&env, &sender).unwrap();
        crate::rate_limit::check_rate_limit(&env, &sender).unwrap();
    });

    let within_window = contract.get_rate_limit_status(&sender);
    assert_eq!(within_window, (2, 100, 60));

    // Advance beyond default 60s window.
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 61;
    });

    let next_window = contract.get_rate_limit_status(&sender);
    assert_eq!(next_window, (0, 100, 60));
}

#[test]
fn test_rate_limit_getters_return_not_initialized_before_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let contract = create_swiftremit_contract(&env);
    let addr = Address::generate(&env);

    let cfg_result = contract.try_get_rate_limit_config();
    assert_eq!(cfg_result.unwrap_err().unwrap(), ContractError::NotInitialized);

    let status_result = contract.try_get_rate_limit_status(&addr);
    assert_eq!(status_result.unwrap_err().unwrap(), ContractError::NotInitialized);
}

#[test]
fn test_public_is_token_whitelisted_query() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, token, admin, _sender, _agent, token_admin) = setup(&env);
    let other_token = create_token_contract(&env, &token_admin);

    // Initialized token should be whitelisted, unrelated token should not.
    assert!(contract.is_token_whitelisted(&token.address));
    assert!(!contract.is_token_whitelisted(&other_token.address));

    // Whitelisting updates the public query value.
    contract.whitelist_token(&admin, &other_token.address);
    assert!(contract.is_token_whitelisted(&other_token.address));
}

#[test]
fn test_get_admin_count_after_add_remove() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, _sender, _agent, _token_admin) = setup(&env);
    let admin2 = Address::generate(&env);

    assert_eq!(contract.get_admin_count(), 1);

    contract.add_admin(&admin, &admin2);
    assert_eq!(contract.get_admin_count(), 2);

    contract.remove_admin(&admin, &admin2);
    assert_eq!(contract.get_admin_count(), 1);
}

#[test]
fn test_process_expired_remittances_only_processes_eligible_ids() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, token, _admin, sender, agent, _token_admin) = setup(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = 10_000;
    });

    let active_id = contract.create_remittance(&sender, &agent, &1_000, &Some(10_100), &None, &None);
    let expired_id = contract.create_remittance(&sender, &agent, &2_000, &Some(10_001), &None, &None);
    let already_cancelled_id = contract.create_remittance(&sender, &agent, &500, &Some(10_001), &None, &None);
    contract.cancel_remittance(&already_cancelled_id);

    env.ledger().with_mut(|li| {
        li.timestamp = 10_002;
    });

    let sender_balance_before = token::Client::new(&env, &token.address).balance(&sender);

    let mut ids = Vec::new(&env);
    ids.push_back(active_id);
    ids.push_back(expired_id);
    ids.push_back(already_cancelled_id);

    let processed = contract.process_expired_remittances(&ids);
    assert_eq!(processed.len(), 1);
    assert_eq!(processed.get_unchecked(0), expired_id);

    assert_eq!(contract.get_remittance(&active_id).status, crate::RemittanceStatus::Pending);
    assert_eq!(contract.get_remittance(&expired_id).status, crate::RemittanceStatus::Cancelled);
    assert_eq!(
        contract.get_remittance(&already_cancelled_id).status,
        crate::RemittanceStatus::Cancelled
    );

    let sender_balance_after = token::Client::new(&env, &token.address).balance(&sender);
    assert_eq!(sender_balance_after, sender_balance_before + 2_000);
}

#[test]
fn test_process_expired_remittances_enforces_batch_size_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, _admin, _sender, _agent, _token_admin) = setup(&env);

    let mut ids = Vec::new(&env);
    for i in 0..51u64 {
        ids.push_back(i + 1);
    }

    let result = contract.try_process_expired_remittances(&ids);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::InvalidBatchSize);
}

#[test]
fn test_batch_netting_opposing_flow_scenario_one() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, _admin, p1, p2, _token_admin) = setup(&env);
    contract.register_agent(&p1);
    contract.register_agent(&p2);

    let id1 = contract.create_remittance(&p1, &p2, &5_000, &None, &None, &None);
    let id2 = contract.create_remittance(&p2, &p1, &3_000, &None, &None, &None);
    let id3 = contract.create_remittance(&p1, &p2, &2_000, &None, &None, &None);

    let expected_fees = contract.get_remittance(&id1).fee
        + contract.get_remittance(&id2).fee
        + contract.get_remittance(&id3).fee;

    let mut entries = Vec::new(&env);
    entries.push_back(BatchSettlementEntry { remittance_id: id1 });
    entries.push_back(BatchSettlementEntry { remittance_id: id2 });
    entries.push_back(BatchSettlementEntry { remittance_id: id3 });

    let result = contract.batch_settle_with_netting(&entries);
    assert_eq!(result.settled_ids.len(), 3);
    assert_eq!(contract.get_accumulated_fees(), expected_fees);
}

#[test]
fn test_batch_netting_opposing_flow_scenario_two() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, _admin, p1, p2, _token_admin) = setup(&env);
    let p3 = Address::generate(&env);
    contract.register_agent(&p1);
    contract.register_agent(&p2);
    contract.register_agent(&p3);

    let id1 = contract.create_remittance(&p1, &p2, &4_000, &None, &None, &None);
    let id2 = contract.create_remittance(&p2, &p1, &1_500, &None, &None, &None);
    let id3 = contract.create_remittance(&p2, &p3, &2_000, &None, &None, &None);
    let id4 = contract.create_remittance(&p3, &p2, &500, &None, &None, &None);

    let expected_fees = contract.get_remittance(&id1).fee
        + contract.get_remittance(&id2).fee
        + contract.get_remittance(&id3).fee
        + contract.get_remittance(&id4).fee;

    let mut entries = Vec::new(&env);
    entries.push_back(BatchSettlementEntry { remittance_id: id1 });
    entries.push_back(BatchSettlementEntry { remittance_id: id2 });
    entries.push_back(BatchSettlementEntry { remittance_id: id3 });
    entries.push_back(BatchSettlementEntry { remittance_id: id4 });

    let result = contract.batch_settle_with_netting(&entries);
    assert_eq!(result.settled_ids.len(), 4);
    assert_eq!(contract.get_accumulated_fees(), expected_fees);
}

#[test]
fn test_batch_netting_opposing_flow_scenario_three() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, _admin, p1, p2, _token_admin) = setup(&env);
    let p3 = Address::generate(&env);
    let p4 = Address::generate(&env);

    contract.register_agent(&p1);
    contract.register_agent(&p2);
    contract.register_agent(&p3);
    contract.register_agent(&p4);

    let id1 = contract.create_remittance(&p1, &p2, &8_000, &None, &None, &None);
    let id2 = contract.create_remittance(&p2, &p1, &3_500, &None, &None, &None);
    let id3 = contract.create_remittance(&p3, &p4, &6_000, &None, &None, &None);
    let id4 = contract.create_remittance(&p4, &p3, &2_000, &None, &None, &None);
    let id5 = contract.create_remittance(&p1, &p2, &500, &None, &None, &None);

    let expected_fees = contract.get_remittance(&id1).fee
        + contract.get_remittance(&id2).fee
        + contract.get_remittance(&id3).fee
        + contract.get_remittance(&id4).fee
        + contract.get_remittance(&id5).fee;

    let mut entries = Vec::new(&env);
    entries.push_back(BatchSettlementEntry { remittance_id: id1 });
    entries.push_back(BatchSettlementEntry { remittance_id: id2 });
    entries.push_back(BatchSettlementEntry { remittance_id: id3 });
    entries.push_back(BatchSettlementEntry { remittance_id: id4 });
    entries.push_back(BatchSettlementEntry { remittance_id: id5 });

    let result = contract.batch_settle_with_netting(&entries);
    assert_eq!(result.settled_ids.len(), 5);
    assert_eq!(contract.get_accumulated_fees(), expected_fees);
}
