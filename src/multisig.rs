//! Multi-signature admin operation module for SwiftRemit.
//!
//! High-impact admin operations (fee changes, fee withdrawals, pause/unpause) require
//! M-of-N admin approval before execution.  The flow is:
//!
//! 1. An admin calls `propose_operation` — the proposer counts as the first approval.
//! 2. Other admins call `approve_operation` — each call adds one approval.
//! 3. When `approvers.len() >= threshold` the operation executes automatically.
//! 4. Operations that have not reached threshold within `ttl_seconds` can be swept
//!    with `expire_operation`.
//!
//! Configuration (threshold and TTL) is set with `set_multisig_config` (admin-only)
//! and defaults to threshold=1 / TTL=86400 s until explicitly configured.

use soroban_sdk::{token, Address, Env, Vec};

use crate::{
    events::{
        emit_operation_approved, emit_operation_executed, emit_operation_expired,
        emit_operation_proposed,
    },
    storage::{
        get_accumulated_fees, get_multisig_threshold, get_multisig_ttl_seconds,
        get_pending_operation, get_usdc_token, next_operation_id, remove_pending_operation,
        require_admin, set_accumulated_fees, set_fee_strategy, set_multisig_threshold,
        set_multisig_ttl_seconds, set_paused, set_pending_operation, set_platform_fee_bps,
    },
    AdminOperationType, ContractError, FeeStrategy, PendingOperation,
};

/// Numeric tag used in events to identify operation types without embedding the full enum.
fn op_type_tag(op: &AdminOperationType) -> u32 {
    match op {
        AdminOperationType::UpdateFee => 1,
        AdminOperationType::WithdrawFees => 2,
        AdminOperationType::Pause => 3,
        AdminOperationType::Unpause => 4,
    }
}

/// Configure multi-sig threshold and TTL. Only the existing admin can call this.
///
/// * `threshold` — number of approvals required (must be ≥ 1)
/// * `ttl_seconds` — lifetime of pending operations in seconds (must be > 0)
pub fn set_multisig_config(
    env: &Env,
    caller: Address,
    threshold: u32,
    ttl_seconds: u64,
) -> Result<(), ContractError> {
    require_admin(env, &caller)?;

    if threshold == 0 {
        return Err(ContractError::InvalidMultiSigThreshold);
    }
    if ttl_seconds == 0 {
        return Err(ContractError::InvalidAmount);
    }

    set_multisig_threshold(env, threshold);
    set_multisig_ttl_seconds(env, ttl_seconds);
    Ok(())
}

/// Propose a high-impact admin operation.
///
/// The proposer is automatically counted as the first approval.  If the configured
/// threshold is 1 the operation executes immediately without waiting for additional
/// approvals.
///
/// Returns the new `operation_id`.
pub fn propose_operation(
    env: &Env,
    proposer: Address,
    operation_type: AdminOperationType,
    fee_bps: u32,
    withdraw_to: Option<Address>,
) -> Result<u64, ContractError> {
    require_admin(env, &proposer)?;

    let threshold = get_multisig_threshold(env);
    let ttl_seconds = get_multisig_ttl_seconds(env);
    let proposed_at = env.ledger().timestamp();
    let op_id = next_operation_id(env);

    let mut approvers = Vec::new(env);
    approvers.push_back(proposer.clone());

    let op = PendingOperation {
        id: op_id,
        operation_type: operation_type.clone(),
        proposer: proposer.clone(),
        approvers,
        threshold,
        proposed_at,
        ttl_seconds,
        fee_bps,
        withdraw_to,
    };

    emit_operation_proposed(env, op_id, proposer.clone(), op_type_tag(&operation_type));

    if threshold == 1 {
        execute_operation(env, &op)?;
        emit_operation_executed(env, op_id, op_type_tag(&operation_type));
    } else {
        set_pending_operation(env, &op);
        emit_operation_approved(env, op_id, proposer, 1);
    }

    Ok(op_id)
}

/// Add an admin approval to a pending operation.
///
/// When the total approval count reaches the configured threshold the operation
/// executes automatically and the pending record is removed from storage.
pub fn approve_operation(
    env: &Env,
    approver: Address,
    operation_id: u64,
) -> Result<(), ContractError> {
    require_admin(env, &approver)?;

    let mut op = get_pending_operation(env, operation_id)
        .ok_or(ContractError::OperationNotFound)?;

    let now = env.ledger().timestamp();
    if now > op.proposed_at + op.ttl_seconds {
        remove_pending_operation(env, operation_id);
        emit_operation_expired(env, operation_id, op_type_tag(&op.operation_type));
        return Err(ContractError::OperationExpired);
    }

    for i in 0..op.approvers.len() {
        if op.approvers.get_unchecked(i) == approver {
            return Err(ContractError::AlreadyApproved);
        }
    }

    op.approvers.push_back(approver.clone());
    let approval_count = op.approvers.len();

    emit_operation_approved(env, operation_id, approver, approval_count);

    if approval_count >= op.threshold {
        execute_operation(env, &op)?;
        emit_operation_executed(env, operation_id, op_type_tag(&op.operation_type));
        remove_pending_operation(env, operation_id);
    } else {
        set_pending_operation(env, &op);
    }

    Ok(())
}

/// Sweep an expired pending operation out of storage.
///
/// Anyone can call this to clean up stale operations.  Returns an error if the
/// operation does not exist or has not yet expired.
pub fn expire_operation(env: &Env, operation_id: u64) -> Result<(), ContractError> {
    let op = get_pending_operation(env, operation_id)
        .ok_or(ContractError::OperationNotFound)?;

    let now = env.ledger().timestamp();
    if now <= op.proposed_at + op.ttl_seconds {
        return Err(ContractError::OperationNotFound);
    }

    emit_operation_expired(env, operation_id, op_type_tag(&op.operation_type));
    remove_pending_operation(env, operation_id);
    Ok(())
}

/// Retrieve a pending operation by ID.
pub fn get_operation(env: &Env, operation_id: u64) -> Result<PendingOperation, ContractError> {
    get_pending_operation(env, operation_id).ok_or(ContractError::OperationNotFound)
}

/// Internal: execute the action described by a pending operation.
fn execute_operation(env: &Env, op: &PendingOperation) -> Result<(), ContractError> {
    match &op.operation_type {
        AdminOperationType::UpdateFee => {
            set_platform_fee_bps(env, op.fee_bps);
            set_fee_strategy(env, &FeeStrategy::Percentage(op.fee_bps));
        }
        AdminOperationType::WithdrawFees => {
            let fees = get_accumulated_fees(env)?;
            if fees <= 0 {
                return Err(ContractError::NoFeesToWithdraw);
            }
            let to = op.withdraw_to.clone().ok_or(ContractError::InvalidAddress)?;
            let usdc_token = get_usdc_token(env)?;
            let token_client = token::Client::new(env, &usdc_token);
            token_client.transfer(&env.current_contract_address(), &to, &fees);
            set_accumulated_fees(env, 0);
        }
        AdminOperationType::Pause => {
            set_paused(env, true);
        }
        AdminOperationType::Unpause => {
            set_paused(env, false);
        }
    }
    Ok(())
}
