#![cfg(test)]
extern crate std;

use crate::{AdminOperationType, ContractError, SwiftRemitContract, SwiftRemitContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger as _},
    token, Address, Env, Symbol,
};

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
fn test_set_multisig_config_threshold_one() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    contract.set_multisig_config(&admin, &1, &86400);

    // Query the config via get_operation to verify it was set
    // Default threshold should be 1, so this just verifies no error
    assert_eq!(env.auths().len(), 1);
}

#[test]
fn test_set_multisig_config_threshold_multiple() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    contract.set_multisig_config(&admin, &3, &86400);

    assert_eq!(env.auths().len(), 1);
}

#[test]
fn test_set_multisig_config_invalid_threshold_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    let result = contract.try_set_multisig_config(&admin, &0, &86400);
    assert_eq!(result, Err(Ok(ContractError::InvalidMultiSigThreshold)));
}

#[test]
fn test_set_multisig_config_invalid_ttl_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    let result = contract.try_set_multisig_config(&admin, &1, &0);
    assert_eq!(result, Err(Ok(ContractError::InvalidAmount)));
}

#[test]
fn test_propose_operation_threshold_one_executes_immediately() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    contract.set_multisig_config(&admin, &1, &86400);

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &500,
        &None,
    );

    assert_eq!(op_id, 1);

    // Since threshold is 1, operation should execute immediately
    let result = contract.try_get_pending_operation(&op_id);
    assert_eq!(result, Err(Ok(ContractError::OperationNotFound)));
}

#[test]
fn test_propose_operation_threshold_multiple_pending() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    contract.set_multisig_config(&admin, &2, &86400);

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &500,
        &None,
    );

    assert_eq!(op_id, 1);

    // Operation should be pending, not executed yet
    let op = contract.get_pending_operation(&op_id);
    assert_eq!(op.id, op_id);
    assert_eq!(op.approvers.len(), 1); // Proposer counts as first approval
}

#[test]
fn test_approve_operation_duplicate_approval_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    contract.set_multisig_config(&admin, &2, &86400);

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &500,
        &None,
    );

    // Admin tries to approve again (already approved as proposer)
    let result = contract.try_approve_operation(&admin, &op_id);
    assert_eq!(result, Err(Ok(ContractError::AlreadyApproved)));
}

#[test]
fn test_approve_operation_reaches_threshold_executes() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let admin2 = Address::generate(&env);

    // Set up second admin
    contract.add_admin(&admin, &admin2);

    contract.set_multisig_config(&admin, &2, &86400);

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &500,
        &None,
    );

    // Second admin approves
    contract.approve_operation(&admin2, &op_id);

    // Operation should be executed and removed
    let result = contract.try_get_pending_operation(&op_id);
    assert_eq!(result, Err(Ok(ContractError::OperationNotFound)));
}

#[test]
fn test_approve_operation_below_threshold_stays_pending() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);

    contract.add_admin(&admin, &admin2);
    contract.add_admin(&admin, &admin3);

    contract.set_multisig_config(&admin, &3, &86400);

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &500,
        &None,
    );

    // Second admin approves (2/3)
    contract.approve_operation(&admin2, &op_id);

    // Operation should still be pending
    let op = contract.get_pending_operation(&op_id);
    assert_eq!(op.approvers.len(), 2);
}

#[test]
fn test_approve_operation_after_expiry_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let admin2 = Address::generate(&env);

    contract.add_admin(&admin, &admin2);

    contract.set_multisig_config(&admin, &2, &1); // 1 second TTL

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &500,
        &None,
    );

    // Advance time past TTL
    env.ledger().set_timestamp(env.ledger().timestamp() + 2);

    // Trying to approve should fail
    let result = contract.try_approve_operation(&admin2, &op_id);
    assert_eq!(result, Err(Ok(ContractError::OperationExpired)));
}

#[test]
fn test_expire_operation_before_ttl_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    contract.set_multisig_config(&admin, &2, &86400);

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &500,
        &None,
    );

    // Try to expire before TTL
    let result = contract.try_expire_operation(&op_id);
    assert_eq!(result, Err(Ok(ContractError::OperationNotFound)));
}

#[test]
fn test_expire_operation_after_ttl_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    contract.set_multisig_config(&admin, &2, &1);

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &500,
        &None,
    );

    // Advance time past TTL
    env.ledger().set_timestamp(env.ledger().timestamp() + 2);

    // Should be able to expire now
    contract.expire_operation(&op_id);

    // Operation should be removed
    let result = contract.try_get_pending_operation(&op_id);
    assert_eq!(result, Err(Ok(ContractError::OperationNotFound)));
}

#[test]
fn test_get_pending_operation_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    let result = contract.try_get_pending_operation(&999);
    assert_eq!(result, Err(Ok(ContractError::OperationNotFound)));
}

#[test]
fn test_get_pending_operation_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    contract.set_multisig_config(&admin, &2, &86400);

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &500,
        &None,
    );

    let op = contract.get_pending_operation(&op_id);
    assert_eq!(op.id, op_id);
    assert_eq!(op.fee_bps, 500);
    assert_eq!(op.approvers.get_unchecked(0), admin);
}

#[test]
fn test_changing_multisig_config_invalidates_flights() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);

    // We need 3 admins so that threshold=3 is a valid value (≤ admin_count).
    contract.add_admin(&admin, &admin2);
    contract.add_admin(&admin, &admin3);

    // Set initial threshold to 2 via direct call (threshold was 1, so this is
    // allowed without going through the proposal flow).
    contract.set_multisig_config(&admin, &2, &86400);

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &500,
        &None,
    );

    // Change threshold to 3 — current threshold is 2 > 1 so we must go through
    // propose_multisig_config and get the required approvals.
    let cfg_op_id = contract.propose_multisig_config(&admin, &3, &86400);
    // Need 2 approvals (current threshold=2).  The proposer already counts as 1.
    contract.approve_operation(&admin2, &cfg_op_id);
    // Operation should now be executed and removed (threshold reached).
    let result = contract.try_get_pending_operation(&cfg_op_id);
    assert_eq!(result, Err(Ok(ContractError::OperationNotFound)));

    // The in-flight fee proposal (op_id) was created under the old threshold=2.
    // It must still be present in storage and must retain its original threshold.
    let op = contract.get_pending_operation(&op_id);
    assert_eq!(op.threshold, 2); // Stored threshold when operation was proposed

    // Lower threshold back to 2 via the proposal flow (current threshold=3 now).
    let cfg_op_id2 = contract.propose_multisig_config(&admin, &2, &86400);
    contract.approve_operation(&admin2, &cfg_op_id2);
    contract.approve_operation(&admin3, &cfg_op_id2);
    let result = contract.try_get_pending_operation(&cfg_op_id2);
    assert_eq!(result, Err(Ok(ContractError::OperationNotFound)));

    // The original in-flight operation still retains the threshold from when it
    // was proposed.
    let op = contract.get_pending_operation(&op_id);
    assert_eq!(op.threshold, 2); // Still uses the original threshold
}

#[test]
fn test_operation_execute_with_pause() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    contract.set_multisig_config(&admin, &1, &86400);

    // Propose and immediately execute pause operation
    contract.propose_operation(
        &admin,
        &AdminOperationType::Pause,
        &0,
        &None,
    );

    // Contract should be paused now
    assert!(contract.is_paused());
}

#[test]
fn test_operation_execute_with_unpause() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    contract.set_multisig_config(&admin, &1, &86400);

    // First pause
    contract.propose_operation(
        &admin,
        &AdminOperationType::Pause,
        &0,
        &None,
    );

    assert!(contract.is_paused());

    // Then unpause
    contract.propose_operation(
        &admin,
        &AdminOperationType::Unpause,
        &0,
        &None,
    );

    assert!(!contract.is_paused());
}

#[test]
fn test_multisig_threshold_enforcement() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);

    contract.add_admin(&admin, &admin2);
    contract.add_admin(&admin, &admin3);

    // Set threshold to 2
    contract.set_multisig_config(&admin, &2, &86400);

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &300,
        &None,
    );

    // Only one approval (proposer), should be pending
    let op = contract.get_pending_operation(&op_id);
    assert_eq!(op.approvers.len(), 1);

    // Second approval reaches threshold, executes
    contract.approve_operation(&admin2, &op_id);

    // Should be executed and removed
    let result = contract.try_get_pending_operation(&op_id);
    assert_eq!(result, Err(Ok(ContractError::OperationNotFound)));
}

#[test]
fn test_approve_from_non_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let non_admin = Address::generate(&env);

    contract.set_multisig_config(&admin, &2, &86400);

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &500,
        &None,
    );

    // Non-admin tries to approve
    let result = contract.try_approve_operation(&non_admin, &op_id);
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

#[test]
fn test_propose_from_non_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let non_admin = Address::generate(&env);

    // Non-admin tries to propose
    let result = contract.try_propose_operation(
        &non_admin,
        &AdminOperationType::UpdateFee,
        &500,
        &None,
    );
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

#[test]
fn test_multiple_concurrent_operations() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let admin2 = Address::generate(&env);

    contract.add_admin(&admin, &admin2);
    contract.set_multisig_config(&admin, &2, &86400);

    // Propose first operation
    let op_id_1 = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &300,
        &None,
    );

    // Propose second operation
    let op_id_2 = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &400,
        &None,
    );

    assert_eq!(op_id_1, 1);
    assert_eq!(op_id_2, 2);

    // Both should be pending
    let op1 = contract.get_pending_operation(&op_id_1);
    let op2 = contract.get_pending_operation(&op_id_2);

    assert_eq!(op1.fee_bps, 300);
    assert_eq!(op2.fee_bps, 400);
}

// ═══════════════════════════════════════════════════════════════════════════
// Regression tests: `set_multisig_config` must not let a single admin bypass
// an already-configured quorum (see propose_multisig_config).
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_set_multisig_config_direct_call_blocked_once_threshold_above_one() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let admin2 = Address::generate(&env);

    contract.add_admin(&admin, &admin2);
    contract.set_multisig_config(&admin, &2, &86400);

    // A single admin can no longer call set_multisig_config directly, even to
    // *raise* the threshold further — and critically, not to lower it back to 1
    // either, which is exactly the bypass this guards against.
    let result = contract.try_set_multisig_config(&admin, &1, &86400);
    assert_eq!(result, Err(Ok(ContractError::MultisigQuorumRequired)));

    let result = contract.try_set_multisig_config(&admin, &5, &86400);
    assert_eq!(result, Err(Ok(ContractError::MultisigQuorumRequired)));
}

#[test]
fn test_set_multisig_config_cannot_be_used_to_solo_execute_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let admin2 = Address::generate(&env);

    contract.add_admin(&admin, &admin2);
    contract.set_multisig_config(&admin, &2, &86400);

    // Attempting the historical bypass: drop the threshold to 1 directly, then
    // solo-propose a WithdrawFees. The config drop itself must fail, so the
    // WithdrawFees proposal remains gated behind the original 2-of-N threshold.
    let bypass = contract.try_set_multisig_config(&admin, &1, &86400);
    assert_eq!(bypass, Err(Ok(ContractError::MultisigQuorumRequired)));

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &999,
        &None,
    );

    // Still pending — a single approval (the proposer) is not enough at threshold=2.
    let op = contract.get_pending_operation(&op_id);
    assert_eq!(op.approvers.len(), 1);
    assert_eq!(op.threshold, 2);
}

#[test]
fn test_propose_multisig_config_requires_quorum_to_take_effect() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);

    contract.add_admin(&admin, &admin2);
    contract.add_admin(&admin, &admin3);
    contract.set_multisig_config(&admin, &3, &86400);

    // Proposing a config change alone is not enough — it needs the current
    // threshold's worth of approvals (3) before it takes effect.
    let op_id = contract.propose_multisig_config(&admin, &1, &86400);

    let op = contract.get_pending_operation(&op_id);
    assert_eq!(op.approvers.len(), 1);
    assert_eq!(op.new_threshold, 1);

    // Direct calls are still blocked while the proposal is pending.
    let bypass = contract.try_set_multisig_config(&admin, &1, &86400);
    assert_eq!(bypass, Err(Ok(ContractError::MultisigQuorumRequired)));

    // Second approval — still below threshold=3, config unchanged.
    contract.approve_operation(&admin2, &op_id);
    let bypass = contract.try_set_multisig_config(&admin, &1, &86400);
    assert_eq!(bypass, Err(Ok(ContractError::MultisigQuorumRequired)));

    // Third approval reaches quorum: the config change executes and the
    // threshold is now genuinely 1, settable directly again.
    contract.approve_operation(&admin3, &op_id);
    let result = contract.try_get_pending_operation(&op_id);
    assert_eq!(result, Err(Ok(ContractError::OperationNotFound)));

    contract.set_multisig_config(&admin, &2, &86400);
}

#[test]
fn test_propose_multisig_config_executes_immediately_at_threshold_one() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    // Default threshold is 1, so a config-change proposal executes immediately,
    // same as any other operation type at threshold=1.
    let op_id = contract.propose_multisig_config(&admin, &2, &43200);

    let result = contract.try_get_pending_operation(&op_id);
    assert_eq!(result, Err(Ok(ContractError::OperationNotFound)));

    // The new threshold (2) is now active and direct calls are blocked.
    let bypass = contract.try_set_multisig_config(&admin, &1, &86400);
    assert_eq!(bypass, Err(Ok(ContractError::MultisigQuorumRequired)));
}

#[test]
fn test_propose_operation_rejects_update_multisig_config_variant() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    // The generic propose_operation entry point doesn't carry a
    // new_threshold/new_ttl_seconds payload, so UpdateMultisigConfig must be
    // proposed via `propose_multisig_config` instead.
    let result = contract.try_propose_operation(
        &admin,
        &AdminOperationType::UpdateMultisigConfig,
        &0,
        &None,
    );
    assert_eq!(result, Err(Ok(ContractError::MultisigQuorumRequired)));
}
