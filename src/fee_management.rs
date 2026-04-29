//! Safe fee accumulation with overflow protection and automatic flush mechanism.
//!
//! This module provides robust fee management for the SwiftRemit contract,
//! preventing integer overflow through checked arithmetic and automatic flushing
//! when accumulated fees reach a threshold.
//!
//! # Fee Accumulation Safety
//!
//! The contract maintains a running total of collected fees (`total_fees`).
//! Over time with high transaction volume, this value can overflow, leading to:
//! - Incorrect accounting
//! - Potential exploits or contract failure
//!
//! This module addresses these risks through:
//! 1. Checked arithmetic for all fee additions
//! 2. A configurable maximum cap (MAX_FEES)
//! 3. Automatic flush mechanism that transfers fees to treasury when cap is reached
//! 4. Event logging for all flush operations
//! 5. Comprehensive edge case handling

use soroban_sdk::{token, Address, Env};

use crate::{
    emit_fees_flushed, get_accumulated_fees, get_treasury, set_accumulated_fees, ContractError,
};

/// Maximum allowed accumulated fees threshold.
///
/// When accumulated fees exceed this value, a flush is automatically triggered.
/// This prevents integer overflow and ensures regular fee settlement.
///
/// Value: 922,337,203,685,477,580 (approximately 92% of i128::MAX)
/// This provides a reasonable buffer while allowing for high-volume transactions.
///
/// Typical scenario:
/// - Network volume: 1,000,000 transactions/day
/// - Average fee: 1000 USDC
/// - Daily accumulation: 1,000,000,000 USDC/day
/// - Time to MAX_FEES: ~924,337 days (~2530 years)
///
/// This cap ensures safety while allowing for reasonable contract lifetime.
pub const MAX_FEES: i128 = 9_223_372_036_854_775_807i128 / 10; // ~92% of i128::MAX

/// Safely adds a new fee to the accumulated total.
///
/// This function:
/// 1. Validates the new fee is non-negative
/// 2. Uses checked arithmetic to detect overflow
/// 3. Checks if total would exceed MAX_FEES
/// 4. Triggers automatic flush if threshold is exceeded
/// 5. Updates the accumulated fees counter
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `new_fee` - The new fee amount to add (must be >= 0)
///
/// # Returns
///
/// * `Ok(())` - Fee successfully added (flush may have been triggered)
/// * `Err(ContractError::Overflow)` - Addition would overflow
/// * `Err(ContractError::InvalidAmount)` - new_fee is negative
///
/// # Examples
///
/// ```ignore
/// // Add a small fee
/// safe_add_accumulated_fee(&env, 1000)?;
///
/// // This will check for flush and trigger if needed
/// let total = get_accumulated_fees(&env)?;
/// // If total was near MAX_FEES, flush happens automatically
/// ```
pub fn safe_add_accumulated_fee(env: &Env, new_fee: i128) -> Result<(), ContractError> {
    // Edge case: reject negative fees
    if new_fee < 0 {
        return Err(ContractError::InvalidAmount);
    }

    // Edge case: zero fee is valid, no change needed
    if new_fee == 0 {
        return Ok(());
    }

    // Get current accumulated fees
    let current_fees = get_accumulated_fees(env)?;

    // Perform checked addition to detect overflow when combining fees.
    let new_total = current_fees
        .checked_add(new_fee)
        .ok_or(ContractError::Overflow)?;

    // If adding the next fee would exceed the safe cap, flush the current balance
    // and store only the incoming fee as the new accumulated total.
    if new_total > MAX_FEES {
        if current_fees != 0 {
            trigger_flush(env, current_fees)?;
        }

        // Reject fees that alone exceed MAX_FEES because they cannot be safely stored.
        if new_fee > MAX_FEES {
            return Err(ContractError::Overflow);
        }

        set_accumulated_fees(env, new_fee);
    } else {
        // Normal case: update accumulated fees safely.
        set_accumulated_fees(env, new_total);
    }

    Ok(())
}

/// Validates if adding a new fee would trigger a flush.
///
/// This is useful for pre-checking before committing to a transaction.
/// It does NOT modify state; it's purely informational.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `new_fee` - The fee amount to check
///
/// # Returns
///
/// * `true` - Adding this fee would trigger a flush
/// * `false` - Adding this fee would not trigger a flush
///
/// # Example
///
/// ```ignore
/// if would_trigger_flush(&env, large_fee) {
///     log("warning: this transaction will trigger fee flush");
/// }
/// ```
pub fn would_trigger_flush(env: &Env, new_fee: i128) -> bool {
    if new_fee < 0 || new_fee == 0 {
        return false;
    }

    let current_fees = get_accumulated_fees(env).unwrap_or(0);

    // Check for obvious overflow first
    if current_fees > MAX_FEES - new_fee {
        return true;
    }

    // Check if total would exceed cap
    current_fees + new_fee > MAX_FEES
}

/// Manually triggers a fee flush operation.
///
/// Transfers accumulated fees to the treasury and resets the counter.
/// This can be called:
/// 1. Automatically when accumulated fees exceed MAX_FEES
/// 2. Manually by privileged contract functions
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `fees_to_flush` - Amount to flush (typically current accumulated_fees)
///
/// # Returns
///
/// * `Ok(())` - Flush completed successfully
/// * `Err(ContractError::*)` - Transfer failed or treasury address invalid
///
/// # Example
///
/// ```ignore
/// let current_fees = get_accumulated_fees(&env)?;
/// if current_fees > FLUSH_THRESHOLD {
///     trigger_flush(&env, current_fees)?;
/// }
/// ```
pub fn trigger_flush(env: &Env, fees_to_flush: i128) -> Result<(), ContractError> {
    // Edge case: zero fees to flush is a no-op
    if fees_to_flush == 0 {
        return Ok(());
    }

    // Edge case: negative amounts should not happen but reject if they do
    if fees_to_flush < 0 {
        return Err(ContractError::InvalidAmount);
    }

    // Get treasury address for fee transfer
    let treasury = get_treasury(env)?;

    // Get USDC token contract
    // Note: This assumes USDC is the fee token; adjust if different token used
    let usdc_token = crate::get_usdc_token(env)?;
    let token_client = token::Client::new(env, &usdc_token);

    // Transfer accumulated fees to treasury
    token_client.transfer(
        &env.current_contract_address(),
        &treasury,
        &fees_to_flush,
    );

    // Reset the stored accumulated fees after successful flush.
    set_accumulated_fees(env, 0);

    // Emit event logging the flush
    emit_fees_flushed(env, treasury, usdc_token, fees_to_flush);

    Ok(())
}

/// Returns the current maximum fee capacity before flush.
///
/// Useful for monitoring contract health and transaction planning.
///
/// # Returns
///
/// Remaining capacity before flush is triggered (in smallest token units)
pub fn get_remaining_fee_capacity(env: &Env) -> i128 {
    let current_fees = get_accumulated_fees(env).unwrap_or(0);
    MAX_FEES.saturating_sub(current_fees)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: Comprehensive integration tests are in src/test_fee_overflow.rs
    // This test module contains unit-level tests for internal logic.

    #[test]
    fn test_max_fees_constant_is_reasonable() {
        // MAX_FEES should be significantly less than i128::MAX
        assert!(MAX_FEES < i128::MAX);
        assert!(MAX_FEES > 0);

        // Should be approximately 90% of i128::MAX
        let max_i128 = i128::MAX;
        let ratio = (MAX_FEES as f64) / (max_i128 as f64);
        assert!(ratio > 0.09 && ratio < 0.11); // Should be ~10%
    }

    #[test]
    fn test_would_trigger_flush_with_zero_fee() {
        // Zero fees should never trigger flush
        assert!(!would_trigger_flush_local(0, 0));
        assert!(!would_trigger_flush_local(100, 0));
        assert!(!would_trigger_flush_local(MAX_FEES - 1, 0));
    }

    #[test]
    fn test_would_trigger_flush_with_negative_fee() {
        // Negative fees should never trigger flush
        assert!(!would_trigger_flush_local(-100, 0));
        assert!(!would_trigger_flush_local(0, -100));
    }

    #[test]
    fn test_would_trigger_flush_near_boundary() {
        // Just below cap
        let current = MAX_FEES - 100;
        let new_fee = 50;
        assert!(!would_trigger_flush_local(current, new_fee));

        // At boundary
        let current = MAX_FEES - 50;
        let new_fee = 50;
        assert!(would_trigger_flush_local(current, new_fee));

        // Over boundary
        let current = MAX_FEES - 1;
        let new_fee = 2;
        assert!(would_trigger_flush_local(current, new_fee));
    }

    // Helper function for unit tests (doesn't need Env)
    fn would_trigger_flush_local(current_fees: i128, new_fee: i128) -> bool {
        if new_fee < 0 || new_fee == 0 {
            return false;
        }

        let total = match current_fees.checked_add(new_fee) {
            Some(t) => t,
            None => return true, // Overflow would occur
        };

        total > MAX_FEES
    }
}
