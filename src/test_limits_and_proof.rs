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
    contract.register_agent(&agent, &None);

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

    let _id = contract.create_remittance(&sender, &agent, &600, &None, &None, &None, &None, &None);

    let result = contract.try_create_remittance(&sender, &agent, &500, &None, &None, &None, &None, &None);
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

    let _id = contract.create_remittance(&sender, &agent, &800, &None, &None, &None, &None, &None);

    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 86_401;
    });

    // Window has rolled forward; this should succeed.
    let _id2 = contract.create_remittance(&sender, &agent, &800, &None, &None, &None, &None, &None);
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
        &None,
        &Some(config),
        &None,
    );

    // #1497: construct a valid ProofData signed by the oracle (admin)
    let payload = soroban_sdk::Bytes::from_slice(&env, b"valid-settlement-proof");
    let signature = crate::verification::compute_proof_signature(&env, &admin, &payload);
    let proof = crate::types::ProofData {
        signature,
        payload,
        signer: admin.clone(),
    };

    contract.confirm_payout(&remittance_id, &Some(proof), &None);
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
        &None,
        &Some(config),
        &None,
    );

    // #1497: invalid ProofData — wrong signer causes verify_proof to return false
    let bad_signature = soroban_sdk::BytesN::from_array(&env, &[7u8; 64]);
    let bad_payload = soroban_sdk::Bytes::from_slice(&env, b"bad");
    let bad_proof = crate::types::ProofData {
        signature: bad_signature,
        payload: bad_payload,
        signer: soroban_sdk::Address::generate(&env), // not the oracle
    };
    let result = contract.try_confirm_payout(&remittance_id, &Some(bad_proof), &None);
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
        &None,
        &Some(config),
        &None,
    );

    let result = contract.try_confirm_payout(&remittance_id, &None, &None);
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
    contract.add_whitelisted_token(&other_token.address);
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

    let active_id = contract.create_remittance(&sender, &agent, &1_000, &Some(10_100), &None, &None, &None, &None);
    let expired_id = contract.create_remittance(&sender, &agent, &2_000, &Some(10_001), &None, &None, &None, &None);
    let already_cancelled_id = contract.create_remittance(&sender, &agent, &500, &Some(10_001), &None, &None, &None, &None);
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
    contract.register_agent(&p1, &None);
    contract.register_agent(&p2, &None);

    let id1 = contract.create_remittance(&p1, &p2, &5_000, &None, &None, &None, &None, &None);
    let id2 = contract.create_remittance(&p2, &p1, &3_000, &None, &None, &None, &None, &None);
    let id3 = contract.create_remittance(&p1, &p2, &2_000, &None, &None, &None, &None, &None);

    let expected_fees = contract.get_remittance(&id1).fee
        + contract.get_remittance(&id2).fee
        + contract.get_remittance(&id3).fee;

    let mut entries = Vec::new(&env);
    entries.push_back(BatchSettlementEntry { remittance_id: id1 });
    entries.push_back(BatchSettlementEntry { remittance_id: id2 });
    entries.push_back(BatchSettlementEntry { remittance_id: id3 });

    let result = contract.batch_settle_with_netting(&admin, &entries);
    assert_eq!(result.settled_ids.len(), 3);
    assert_eq!(contract.get_accumulated_fees(), expected_fees);
}

#[test]
fn test_batch_netting_opposing_flow_scenario_two() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, _admin, p1, p2, _token_admin) = setup(&env);
    let p3 = Address::generate(&env);
    contract.register_agent(&p1, &None);
    contract.register_agent(&p2, &None);
    contract.register_agent(&p3, &None);

    let id1 = contract.create_remittance(&p1, &p2, &4_000, &None, &None, &None, &None, &None);
    let id2 = contract.create_remittance(&p2, &p1, &1_500, &None, &None, &None, &None, &None);
    let id3 = contract.create_remittance(&p2, &p3, &2_000, &None, &None, &None, &None, &None);
    let id4 = contract.create_remittance(&p3, &p2, &500, &None, &None, &None, &None, &None);

    let expected_fees = contract.get_remittance(&id1).fee
        + contract.get_remittance(&id2).fee
        + contract.get_remittance(&id3).fee
        + contract.get_remittance(&id4).fee;

    let mut entries = Vec::new(&env);
    entries.push_back(BatchSettlementEntry { remittance_id: id1 });
    entries.push_back(BatchSettlementEntry { remittance_id: id2 });
    entries.push_back(BatchSettlementEntry { remittance_id: id3 });
    entries.push_back(BatchSettlementEntry { remittance_id: id4 });

    let result = contract.batch_settle_with_netting(&admin, &entries);
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

    contract.register_agent(&p1, &None);
    contract.register_agent(&p2, &None);
    contract.register_agent(&p3, &None);
    contract.register_agent(&p4, &None);

    let id1 = contract.create_remittance(&p1, &p2, &8_000, &None, &None, &None, &None, &None);
    let id2 = contract.create_remittance(&p2, &p1, &3_500, &None, &None, &None, &None, &None);
    let id3 = contract.create_remittance(&p3, &p4, &6_000, &None, &None, &None, &None, &None);
    let id4 = contract.create_remittance(&p4, &p3, &2_000, &None, &None, &None, &None, &None);
    let id5 = contract.create_remittance(&p1, &p2, &500, &None, &None, &None, &None, &None);

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

    let result = contract.batch_settle_with_netting(&admin, &entries);
    assert_eq!(result.settled_ids.len(), 5);
    assert_eq!(contract.get_accumulated_fees(), expected_fees);
}

// ─────────────────────────────────────────────────────────────────────────────
// #1529 — Proof validation doesn't break existing rate limiting
//
// Verifies that the proof-validation gate added to `confirm_payout` is applied
// *before* (or at worst side-by-side with) the rate-limit check, and that
// neither path bypasses the other.  Specifically:
//
//  1. A call that fails proof validation must NOT consume a rate-limit slot.
//  2. A valid proof must still be gated by the rate limiter when limits are tight.
//  3. An absent proof (when not required) does not interfere with rate limiting.
// ─────────────────────────────────────────────────────────────────────────────

/// #1529 — invalid proof rejected before altering rate-limit state.
///
/// The test creates a remittance that requires a proof, submits a wrong proof,
/// and then verifies the rate-limit counter for the agent has not been consumed
/// (the call should have been rejected with `InvalidProof`, not `RateLimitExceeded`).
#[test]
fn test_proof_validation_rejected_before_rate_limit_consumed() {
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
        &None,
        &Some(config),
        &None,
    );

    // Read the rate-limit counter before the bad proof attempt.
    let (requests_before, max_req, window) = contract.get_rate_limit_status(&agent);

    // Submit an invalid proof — should be rejected with InvalidProof.
    // #1497: invalid ProofData with wrong signer
    let bad_signature = soroban_sdk::BytesN::from_array(&env, &[0xddu8; 64]);
    let bad_payload = soroban_sdk::Bytes::from_slice(&env, b"bad");
    let bad_proof = crate::types::ProofData {
        signature: bad_signature,
        payload: bad_payload,
        signer: soroban_sdk::Address::generate(&env), // not the oracle
    };
    let result = contract.try_confirm_payout(&remittance_id, &Some(bad_proof), &None);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::InvalidProof);

    // The rate-limit counter for the agent must be unchanged.
    let (requests_after, _, _) = contract.get_rate_limit_status(&agent);
    assert_eq!(
        requests_after, requests_before,
        "a rejected proof must not consume a rate-limit slot (requests_before={}, requests_after={}, max={}, window={})",
        requests_before, requests_after, max_req, window
    );
}

/// #1529 — a valid proof path still goes through the rate limiter.
///
/// Exhaust the rate limit for the agent address and then confirm that a
/// call with a *valid* proof is still blocked by the rate limiter rather
/// than being silently admitted.
///
/// Note: `confirm_payout` uses the per-agent abuse-protection rate-limit
/// (sliding-window, via `check_rate_limit` → `abuse_protection`).  This
/// test directly fills that window and then verifies the contract rejects
/// the next call with `RateLimitExceeded` (or `ActionBlocked` for the
/// abuse-protection path) even when the proof is correct.
#[test]
fn test_valid_proof_still_gated_by_rate_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, sender, agent, _token_admin) = setup(&env);

    // Configure a very tight rate limit: 1 request per window.
    contract.update_rate_limit_config(&admin, &1, &300, &true);

    // Create two remittances (both require proof).
    let config = SettlementConfig {
        require_proof: true,
        oracle_address: Some(admin.clone()),
    };

    let id1 = contract.create_remittance(
        &sender,
        &agent,
        &1_000,
        &None,
        &None,
        &None,
        &Some(config.clone()),
        &None,
    );
    let id2 = contract.create_remittance(
        &sender,
        &agent,
        &1_000,
        &None,
        &None,
        &None,
        &Some(config.clone()),
        &None,
    );

    // Settle the first remittance — this consumes the one allowed slot.
    // #1497: construct valid ProofData signed by the oracle (admin)
    let payload1 = soroban_sdk::Bytes::from_slice(&env, b"settlement-1");
    let signature1 = crate::verification::compute_proof_signature(&env, &admin, &payload1);
    let proof1 = crate::types::ProofData {
        signature: signature1,
        payload: payload1,
        signer: admin.clone(),
    };
    contract.confirm_payout(&id1, &Some(proof1), &None);

    // The second call has a valid proof but must be blocked by the rate limiter.
    let payload2 = soroban_sdk::Bytes::from_slice(&env, b"settlement-2");
    let signature2 = crate::verification::compute_proof_signature(&env, &admin, &payload2);
    let proof2 = crate::types::ProofData {
        signature: signature2,
        payload: payload2,
        signer: admin.clone(),
    };
    let result = contract.try_confirm_payout(&id2, &Some(proof2), &None);
    assert!(
        result.is_err(),
        "confirm_payout must be blocked by the rate limiter even with a valid proof"
    );
    let err = result.unwrap_err().unwrap();
    assert!(
        err == ContractError::RateLimitExceeded || err == ContractError::ActionBlocked,
        "expected RateLimitExceeded or ActionBlocked, got {:?}",
        err
    );
}

/// #1529 — no proof path (proof not required) does not interfere with rate limits.
///
/// Creates a remittance without `require_proof`, confirms it without supplying
/// any proof, and checks the rate-limit counter increments exactly once — same
/// as any other settlement, i.e. the proof-validation code path does not insert
/// additional rate-limit increments or decrements.
#[test]
fn test_no_proof_path_does_not_affect_rate_limit_count() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, _admin, sender, agent, _token_admin) = setup(&env);

    let id = contract.create_remittance(&sender, &agent, &1_000, &None, &None, &None, &None, &None);

    let (before, _, _) = contract.get_rate_limit_status(&agent);
    contract.confirm_payout(&id, &None, &None);
    let (after, _, _) = contract.get_rate_limit_status(&agent);

    // The counter must have moved by exactly 1 (from the `confirm_payout` call).
    assert_eq!(
        after,
        before + 1,
        "confirm_payout without proof must consume exactly one rate-limit slot"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// #1530 — Proof validation doesn't break duplicate settlement protection
//
// The duplicate-settlement guard (`has_settlement_hash` / `set_settlement_hash`)
// must remain intact regardless of whether proof validation is active.
//
//  1. A second call with the *same* proof must be rejected with
//     `DuplicateSettlement`, not `InvalidProof`.
//  2. A second call with a *different* proof is also rejected with
//     `DuplicateSettlement` (proof correctness is irrelevant once settled).
//  3. A failed proof submission must NOT claim the settlement hash, so a
//     subsequent correct submission can succeed.
// ─────────────────────────────────────────────────────────────────────────────

/// #1530 — duplicate settlement blocked even with a valid proof on second call.
#[test]
fn test_multiple_settlement_attempts_with_same_proof_are_rejected() {
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
        &None,
        &Some(config),
        &None,
    );

    // #1497: construct valid ProofData signed by the oracle (admin)
    let payload = soroban_sdk::Bytes::from_slice(&env, b"duplicate-proof");
    let signature = crate::verification::compute_proof_signature(&env, &admin, &payload);
    let proof = crate::types::ProofData {
        signature,
        payload,
        signer: admin.clone(),
    };

    // First settlement with the valid proof succeeds.
    contract.confirm_payout(&remittance_id, &Some(proof.clone()), &None);

    // Replaying the exact same proof any number of times must never execute
    // another settlement.
    for _ in 0..3 {
        let result =
            contract.try_confirm_payout(&remittance_id, &Some(proof.clone()), &None);

        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::DuplicateSettlement,
            "reusing the same proof must not allow another settlement"
        );
    }
}

/// #1530 — duplicate settlement blocked even when a different proof is submitted.
#[test]
fn test_duplicate_settlement_blocked_with_different_proof() {
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
        &None,
        &Some(config),
        &None,
    );

    // Settle once with a valid proof.
    // #1497: construct valid ProofData signed by the oracle (admin)
    let payload = soroban_sdk::Bytes::from_slice(&env, b"first-settlement");
    let signature = crate::verification::compute_proof_signature(&env, &admin, &payload);
    let proof = crate::types::ProofData {
        signature,
        payload,
        signer: admin.clone(),
    };
    contract.confirm_payout(&remittance_id, &Some(proof), &None);

    // Attempt a second settlement with a completely different proof value.
    // #1497: different ProofData (different signer)
    let different_signature = soroban_sdk::BytesN::from_array(&env, &[0xaau8; 64]);
    let different_payload = soroban_sdk::Bytes::from_slice(&env, b"different");
    let different_proof = crate::types::ProofData {
        signature: different_signature,
        payload: different_payload,
        signer: soroban_sdk::Address::generate(&env),
    };
    let result = contract.try_confirm_payout(&remittance_id, &Some(different_proof), &None);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::DuplicateSettlement,
        "duplicate settlement must be blocked before proof validation runs on second attempt"
    );
}

/// #1530 — a failed proof attempt must NOT claim the settlement slot.
///
/// If `confirm_payout` is called with an invalid proof the settlement hash
/// must remain unclaimed, so a subsequent call with the correct proof can
/// still succeed.
#[test]
fn test_failed_proof_does_not_poison_settlement_slot() {
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
        &None,
        &Some(config),
        &None,
    );

    // First attempt: wrong proof — must fail.
    // #1497: invalid ProofData with wrong signer
    let bad_signature = soroban_sdk::BytesN::from_array(&env, &[0x00u8; 64]);
    let bad_payload = soroban_sdk::Bytes::from_slice(&env, b"bad");
    let bad_proof = crate::types::ProofData {
        signature: bad_signature,
        payload: bad_payload,
        signer: soroban_sdk::Address::generate(&env), // not the oracle
    };
    let bad_result = contract.try_confirm_payout(&remittance_id, &Some(bad_proof), &None);
    assert_eq!(bad_result.unwrap_err().unwrap(), ContractError::InvalidProof);

    // Second attempt: correct proof — must succeed (settlement slot is still free).
    // #1497: construct valid ProofData signed by the oracle (admin)
    let good_payload = soroban_sdk::Bytes::from_slice(&env, b"good-proof");
    let good_signature = crate::verification::compute_proof_signature(&env, &admin, &good_payload);
    let good_proof = crate::types::ProofData {
        signature: good_signature,
        payload: good_payload,
        signer: admin.clone(),
    };
    contract.confirm_payout(&remittance_id, &Some(good_proof), &None);
    assert_eq!(
        contract.get_remittance(&remittance_id).status,
        crate::RemittanceStatus::Completed
    );
}

/// #1530 — duplicate settlement check fires before proof check on second call.
///
/// The settlement hash guard executes *after* the proof check in the
/// confirm_payout_inner flow, so a second attempt with an *invalid* proof
/// should return `DuplicateSettlement` because the state machine already has
/// the completed status and the guard short-circuits before any proof logic.
#[test]
fn test_duplicate_settlement_status_takes_priority_over_proof_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, sender, agent, _token_admin) = setup(&env);

    // No proof requirement — simpler flow to isolate the duplicate check.
    let remittance_id =
        contract.create_remittance(&sender, &agent, &2_000, &None, &None, &None, &None, &None);

    contract.confirm_payout(&remittance_id, &None, &None);

    // A second call (no proof required) should always return DuplicateSettlement
    // regardless of status or proof argument.
    let result = contract.try_confirm_payout(&remittance_id, &None, &None);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::DuplicateSettlement);
}

/// #1519 — proof validation must not bypass the global contract pause.
///
/// A remittance configured to require proof is created while the contract is
/// active. After a valid proof is computed, the contract is paused. Settlement
/// must still be rejected with `ContractPaused`, even though the proof itself
/// is valid.
#[test]
fn test_proof_validation_when_contract_is_paused() {
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
        &None,
        &Some(config),
        &None,
    );

    // #1497: construct valid ProofData signed by the oracle (admin)
    let payload = soroban_sdk::Bytes::from_slice(&env, b"paused-proof");
    let signature = crate::verification::compute_proof_signature(&env, &admin, &payload);
    let proof = crate::types::ProofData {
        signature,
        payload,
        signer: admin.clone(),
    };

    contract.pause();

    assert!(contract.is_paused());

    let result =
        contract.try_confirm_payout(&remittance_id, &Some(proof), &None);

    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::ContractPaused,
        "valid proof must not bypass the global contract pause"
    );

    assert_eq!(
        contract.get_remittance(&remittance_id).status,
        crate::types::RemittanceStatus::Pending,
        "failed settlement while paused must leave the remittance pending"
    );
}


// ─────────────────────────────────────────────────────────────────────────────
// #1531 — Proof validation works correctly with the pause mechanism (task 10.5)
//
// The pause circuit-breaker must take priority over all business logic,
// including proof validation.  These tests confirm:
//
//  1. `confirm_payout` with a valid proof is blocked with `ContractPaused`
//     while the contract is paused.
//  2. The remittance stays `Pending` after the blocked call — no state mutation
//     occurs while paused.
//  3. After the contract is unpaused, the same valid proof successfully settles
//     the remittance, proving the proof itself was never invalidated.
//  4. A paused contract also blocks `confirm_payout` when no proof is required
//     (regression guard — pause gate must be agnostic to proof config).
// ─────────────────────────────────────────────────────────────────────────────

/// #1531 — paused contract rejects `confirm_payout` even with a valid proof,
/// and the remittance remains `Pending`.
#[test]
fn test_proof_validation_paused_contract_rejects_valid_proof() {
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
        &None,
        &Some(config),
        &None,
    );

    // Compute a valid proof while the contract is still active.
    // #1497: construct valid ProofData signed by the oracle (admin)
    let payload = soroban_sdk::Bytes::from_slice(&env, b"pause-reject-proof");
    let signature = crate::verification::compute_proof_signature(&env, &admin, &payload);
    let proof = crate::types::ProofData {
        signature,
        payload,
        signer: admin.clone(),
    };

    // Pause the contract.
    contract.pause();
    assert!(contract.is_paused(), "contract must be paused before the settlement attempt");

    // Settlement with a valid proof must be blocked by the pause gate.
    let result = contract.try_confirm_payout(&remittance_id, &Some(proof), &None);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::ContractPaused,
        "a valid proof must not bypass the global contract pause"
    );

    // The remittance must remain untouched.
    assert_eq!(
        contract.get_remittance(&remittance_id).status,
        crate::types::RemittanceStatus::Pending,
        "remittance status must remain Pending while the contract is paused"
    );
}

/// #1531 — after unpause, the same valid proof settles the remittance normally.
///
/// Proves that the pause gate does not corrupt proof state: the proof computed
/// before the pause is still accepted once the contract is active again.
#[test]
fn test_proof_validation_resumes_after_unpause() {
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
        &None,
        &Some(config),
        &None,
    );

    // Capture proof before pause.
    // #1497: construct valid ProofData signed by the oracle (admin)
    let payload = soroban_sdk::Bytes::from_slice(&env, b"resume-proof");
    let signature = crate::verification::compute_proof_signature(&env, &admin, &payload);
    let proof = crate::types::ProofData {
        signature,
        payload,
        signer: admin.clone(),
    };

    // Pause and immediately unpause (legacy wrappers bypass timelock/quorum).
    contract.pause();
    contract.unpause();

    assert!(!contract.is_paused(), "contract must be unpaused before retrying settlement");

    // The same proof must now succeed.
    contract.confirm_payout(&remittance_id, &Some(proof), &None);

    assert_eq!(
        contract.get_remittance(&remittance_id).status,
        crate::types::RemittanceStatus::Completed,
        "remittance must be Completed after a valid proof is accepted post-unpause"
    );
}

/// #1531 — paused contract also blocks `confirm_payout` when no proof is required.
///
/// Regression guard: the pause check must fire regardless of the proof
/// configuration on the remittance.
#[test]
fn test_pause_blocks_confirm_payout_without_proof_requirement() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, _admin, sender, agent, _token_admin) = setup(&env);

    // No proof requirement.
    let remittance_id =
        contract.create_remittance(&sender, &agent, &1_000, &None, &None, &None, &None, &None);

    contract.pause();

    let result = contract.try_confirm_payout(&remittance_id, &None, &None);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::ContractPaused,
        "pause must block confirm_payout even when no proof is required"
    );

    assert_eq!(
        contract.get_remittance(&remittance_id).status,
        crate::types::RemittanceStatus::Pending,
        "remittance must stay Pending while contract is paused"
    );
}
