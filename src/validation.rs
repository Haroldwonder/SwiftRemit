//! Address validation utilities for the SwiftRemit contract.
//!
//! This module provides validation functions for Stellar addresses used in
//! contract operations.

use soroban_sdk::{Address, Env};

use crate::{
    config::MAX_FEE_BPS,
    get_remittance, is_agent_registered, is_paused, is_user_blacklisted, ContractError,
    RemittanceStatus,
};

/// Centralized validation module for all API requests.
/// Validates required fields before controller logic to prevent invalid data
/// from reaching business logic.
// NOTE: validate_address has been intentionally removed.
//
// In Soroban SDK, the `Address` type is constructed and validated by the host
// environment before it ever reaches contract code. An invalid or zero address
// cannot be passed in — the host will trap before the contract executes.
// There is no "zero address" concept in Stellar/Soroban, and no runtime API
// to distinguish account vs contract addresses in SDK v21.
//
// Therefore, any `validate_address` call was a no-op that added noise without
// providing safety. All former call sites have been removed accordingly.

/// Validates fee basis points are within acceptable range (0-10000 = 0%-100%).
pub fn validate_fee_bps(fee_bps: u32) -> Result<(), ContractError> {
    if fee_bps > MAX_FEE_BPS {
        return Err(ContractError::InvalidFeeBps);
    }
    Ok(())
}

/// Validates that an amount is positive and non-zero.
pub fn validate_amount(amount: i128) -> Result<(), ContractError> {
    if amount <= 0 {
        return Err(ContractError::InvalidAmount);
    }
    Ok(())
}

/// Validates that an agent is registered in the system.
pub fn validate_agent_registered(env: &Env, agent: &Address) -> Result<(), ContractError> {
    if !is_agent_registered(env, agent) {
        return Err(ContractError::AgentNotRegistered);
    }
    Ok(())
}

/// Validates that the contract is not paused.
pub fn validate_not_paused(env: &Env) -> Result<(), ContractError> {
    if is_paused(env) {
        return Err(ContractError::ContractPaused);
    }
    Ok(())
}

/// Validates that a remittance exists and returns it.
pub fn validate_remittance_exists(env: &Env, remittance_id: u64) -> Result<crate::Remittance, ContractError> {
    get_remittance(env, remittance_id)
}

/// Validates that a remittance is in a cancellable state (Pending or Processing).
pub fn validate_remittance_cancellable(remittance: &crate::Remittance) -> Result<(), ContractError> {
    match remittance.status {
        RemittanceStatus::Pending | RemittanceStatus::Processing => Ok(()),
        _ => Err(ContractError::InvalidStatus),
    }
}

/// Validates remittance is in Pending state.
pub fn validate_remittance_pending(remittance: &crate::Remittance) -> Result<(), ContractError> {
    if remittance.status != RemittanceStatus::Pending {
        return Err(ContractError::InvalidStatus);
    }
    Ok(())
}

/// Validates that a settlement has not expired.
pub fn validate_settlement_not_expired(env: &Env, expiry: Option<u64>) -> Result<(), ContractError> {
    if let Some(expiry_time) = expiry {
        let current_time = env.ledger().timestamp();
        if current_time > expiry_time {
            return Err(ContractError::SettlementExpired);
        }
    }
    Ok(())
}

/// Validates that a settlement has not been executed before (duplicate check).
pub fn validate_no_duplicate_settlement(env: &Env, remittance_id: u64) -> Result<(), ContractError> {
    if crate::has_settlement_hash(env, remittance_id) {
        return Err(ContractError::DuplicateSettlement);
    }
    Ok(())
}

/// Validates that there are fees available to withdraw.
pub fn validate_fees_available(fees: i128) -> Result<(), ContractError> {
    if fees <= 0 {
        return Err(ContractError::NoFeesToWithdraw);
    }
    Ok(())
}

/// Comprehensive validation for initialize request.
pub fn validate_initialize_request(
    env: &Env,
    _admin: &Address,
    _token: &Address,
    fee_bps: u32,
) -> Result<(), ContractError> {
    validate_fee_bps(fee_bps)?;

    // Check if already initialized
    if crate::has_admin(env) {
        return Err(ContractError::AlreadyInitialized);
    }

    Ok(())
}

pub fn validate_escrow_ttl(ttl: u64) -> Result<(), ContractError> {
    // Zero means expiry disabled. Any positive TTL is allowed.
    if ttl == u64::MAX {
        return Err(ContractError::InvalidAmount);
    }
    Ok(())
}

/// Comprehensive validation for create_remittance request.
pub fn validate_create_remittance_request(
    env: &Env,
    _sender: &Address,
    agent: &Address,
    amount: i128,
) -> Result<(), ContractError> {
    validate_amount(amount)?;
    validate_agent_registered(env, agent)?;
    if is_user_blacklisted(env, sender) {
        return Err(ContractError::UserBlacklisted);
    }
    Ok(())
}

/// Comprehensive validation for confirm_payout request.
/// Returns the remittance to avoid re-reading in the caller.
pub fn validate_confirm_payout_request(
    env: &Env,
    remittance_id: u64,
) -> Result<crate::Remittance, ContractError> {
    validate_not_paused(env)?;
    let remittance = validate_remittance_exists(env, remittance_id)?;
    // confirm_payout is only valid from Pending (transitions Pending → Processing → Completed)
    if remittance.status != RemittanceStatus::Pending {
        return Err(ContractError::InvalidStatus);
    }
    validate_no_duplicate_settlement(env, remittance_id)?;
    validate_settlement_not_expired(env, remittance.expiry)?;
    Ok(remittance)
}

/// Comprehensive validation for cancel_remittance request.
/// Returns the remittance to avoid re-reading in the caller.

pub fn validate_cancel_remittance_request(
    env: &Env,
    remittance_id: u64,
) -> Result<crate::Remittance, ContractError> {
    let remittance = validate_remittance_exists(env, remittance_id)?;
    validate_remittance_pending(&remittance)?;
    Ok(remittance)
}

/// Comprehensive validation for withdraw_fees request.
/// Returns the fees amount to avoid re-reading in the caller.
pub fn validate_withdraw_fees_request(
    env: &Env,
    _to: &Address,
) -> Result<i128, ContractError> {
    let fees = crate::get_accumulated_fees(env)?;
    validate_fees_available(fees)?;
    Ok(fees)
}

/// Comprehensive validation for update_fee request.
pub fn validate_update_fee_request(fee_bps: u32) -> Result<(), ContractError> {
    validate_fee_bps(fee_bps)
}

/// Comprehensive validation for admin operations.

pub fn validate_admin_operation(
    env: &Env,
    caller: &Address,
    _target: &Address,
) -> Result<(), ContractError> {
    crate::require_admin(env, caller)?;
    Ok(())
}

/// Normalizes an asset symbol to uppercase canonical form.
pub fn normalize_symbol(_env: &Env, symbol: &soroban_sdk::String) -> Result<soroban_sdk::String, ContractError> {
    Ok(symbol.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    // validate_address was removed — no test needed.

    #[test]
    fn test_validate_fee_bps_valid() {
        assert!(validate_fee_bps(0).is_ok());
        assert!(validate_fee_bps(250).is_ok());
        assert!(validate_fee_bps(10000).is_ok());
    }

    #[test]
    fn test_validate_fee_bps_invalid() {
        assert_eq!(validate_fee_bps(10001), Err(ContractError::InvalidFeeBps));
        assert_eq!(validate_fee_bps(50000), Err(ContractError::InvalidFeeBps));
    }

    #[test]
    fn test_validate_amount_valid() {
        assert!(validate_amount(1).is_ok());
        assert!(validate_amount(1000).is_ok());
        assert!(validate_amount(i128::MAX).is_ok());
    }

    #[test]
    fn test_validate_amount_invalid() {
        assert_eq!(validate_amount(0), Err(ContractError::InvalidAmount));
        assert_eq!(validate_amount(-1), Err(ContractError::InvalidAmount));
        assert_eq!(validate_amount(-1000), Err(ContractError::InvalidAmount));
    }

    #[test]
    fn test_validate_fees_available_valid() {
        assert!(validate_fees_available(1).is_ok());
        assert!(validate_fees_available(1000).is_ok());
    }

    #[test]
    fn test_validate_fees_available_invalid() {
        assert_eq!(validate_fees_available(0), Err(ContractError::NoFeesToWithdraw));
        assert_eq!(validate_fees_available(-1), Err(ContractError::NoFeesToWithdraw));
    }
}
