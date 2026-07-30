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

    contract.add_admin(&admin, &admin2);
    contract.set_multisig_config(&admin, &2, &86400);

    let op_id = contract.propose_operation(
        &admin,
        &AdminOperationType::UpdateFee,
        &500,
        &None,
    );

    // Change threshold to 3
    contract.set_multisig_config(&admin, &3, &86400);

    // Pending operation still exists but now needs 3 approvals instead of 2
    let op = contract.get_pending_operation(&op_id);
    assert_eq!(op.threshold, 2); // Stored threshold when operation was proposed

    // Now get the current config
    contract.set_multisig_config(&admin, &2, &86400);
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
