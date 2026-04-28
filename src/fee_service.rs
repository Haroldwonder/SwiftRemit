//! Centralized fee calculation service for the SwiftRemit contract.
//!
//! This module provides a unified interface for all fee calculations, supporting:
//! - Multiple fee strategies (Percentage, Flat, Dynamic)
//! - Protocol fees for treasury
//! - Country-to-country corridor-specific fees
//! - Complete fee breakdowns for transparency
//!
//! All fee calculations route through this module to ensure consistency
//! and prevent calculation errors.

use soroban_sdk::{contracttype, Address, Env, String};

use crate::{
    config::{
        FEE_DIVISOR,
        MIN_FEE,
        SENDER_VOLUME_TIER_FEE_BPS_10K,
        SENDER_VOLUME_TIER_THRESHOLD_10K,
    },
    get_fee_strategy, get_platform_fee_bps, get_protocol_fee_bps, storage, ContractError,
    FeeStrategy,
};

/// Complete breakdown of all fees applied to a transaction
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeBreakdown {
    /// Original transaction amount
    pub amount: i128,
    /// Platform fee charged
    pub platform_fee: i128,
    /// Protocol fee for treasury
    pub protocol_fee: i128,
    /// Net amount after all fees (amount - platform_fee - protocol_fee)
    pub net_amount: i128,
    /// Optional corridor identifier (from_country-to_country)
    pub corridor: Option<String>,
}

impl FeeBreakdown {
    /// Validates that the fee breakdown is mathematically consistent
    ///
    /// Ensures: amount = platform_fee + protocol_fee + net_amount
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Breakdown is valid
    /// * `Err(ContractError::InvalidAmount)` - Breakdown is inconsistent
    pub fn validate(&self) -> Result<(), ContractError> {
        let total = self
            .platform_fee
            .checked_add(self.protocol_fee)
            .and_then(|sum| sum.checked_add(self.net_amount))
            .ok_or(ContractError::Overflow)?;

        if total != self.amount {
            return Err(ContractError::InvalidAmount);
        }

        // Ensure no negative values
        if self.amount < 0 || self.platform_fee < 0 || self.protocol_fee < 0 || self.net_amount < 0
        {
            return Err(ContractError::InvalidAmount);
        }

        Ok(())
    }
}

/// Country-to-country fee corridor configuration
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeCorridor {
    /// Source country code (ISO 3166-1 alpha-2)
    pub from_country: String,
    /// Destination country code (ISO 3166-1 alpha-2)
    pub to_country: String,
    /// Fee strategy for this corridor
    pub strategy: FeeStrategy,
    /// Optional protocol fee override (uses global if None)
    pub protocol_fee_bps: Option<u32>,
}

/// Calculates the platform fee for a given amount using the current fee strategy.
///
/// This is the primary entry point for simple fee calculations during remittance creation.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `amount` - Transaction amount to calculate fee for
///
/// # Returns
///
/// * `Ok(i128)` - Calculated platform fee
/// * `Err(ContractError::InvalidAmount)` - Amount is zero or negative
/// * `Err(ContractError::Overflow)` - Arithmetic overflow in calculation
pub fn calculate_platform_fee(
    env: &Env,
    amount: i128,
    token: Option<&Address>,
) -> Result<i128, ContractError> {
    if amount <= 0 {
        return Err(ContractError::InvalidAmount);
    }

    let strategy = get_effective_fee_strategy(env, token)?;
    calculate_fee_by_strategy(amount, &strategy)
}

/// Calculates the platform fee for a specific sender using rolling volume discounts.
pub fn calculate_platform_fee_for_sender(
    env: &Env,
    sender: &Address,
    amount: i128,
    token: Option<&Address>,
) -> Result<i128, ContractError> {
    if amount <= 0 {
        return Err(ContractError::InvalidAmount);
    }

    let strategy = get_effective_fee_strategy(env, token)?;
    let prior_volume = storage::get_sender_rolling_volume(env, sender, env.ledger().timestamp());
    let total_volume = prior_volume
        .checked_add(amount)
        .ok_or(ContractError::Overflow)?;
    let discounted_strategy = apply_volume_discount(total_volume, strategy)?;
    calculate_fee_by_strategy(amount, &discounted_strategy)
}

/// Calculates the platform fee for a sender given a pre-computed rolling volume.
pub fn calculate_platform_fee_for_volume(
    env: &Env,
    amount: i128,
    token: Option<&Address>,
    total_volume: i128,
) -> Result<i128, ContractError> {
    if amount <= 0 {
        return Err(ContractError::InvalidAmount);
    }

    let strategy = get_effective_fee_strategy(env, token)?;
    let discounted_strategy = apply_volume_discount(total_volume, strategy)?;
    calculate_fee_by_strategy(amount, &discounted_strategy)
}

/// Calculates complete fee breakdown including platform and protocol fees.
///
/// This is the primary entry point for detailed fee calculations during payout confirmation.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `amount` - Transaction amount
/// * `corridor` - Optional corridor configuration for country-specific fees
///
/// # Returns
///
/// * `Ok(FeeBreakdown)` - Complete fee breakdown
/// * `Err(ContractError)` - Validation or calculation error
pub fn calculate_fees_with_breakdown(
    env: &Env,
    amount: i128,
    token: Option<&Address>,
    corridor: Option<&FeeCorridor>,
) -> Result<FeeBreakdown, ContractError> {
    if amount <= 0 {
        return Err(ContractError::InvalidAmount);
    }

    // Determine which strategy and protocol fee to use
    let (strategy, protocol_fee_bps, corridor_id) = if let Some(c) = corridor {
        let protocol_bps = c
            .protocol_fee_bps
            .unwrap_or_else(|| get_protocol_fee_bps(env));
        let id = format_corridor_id(env, &c.from_country, &c.to_country);
        (c.strategy.clone(), protocol_bps, Some(id))
    } else {
        (get_fee_strategy(env), get_protocol_fee_bps(env), None)
    };

    let effective_strategy = get_effective_fee_strategy_for_strategy(env, &strategy, token)?;

    // Calculate platform fee
    let platform_fee = calculate_fee_by_strategy(amount, &effective_strategy)?;

    // Calculate protocol fee
    let protocol_fee = calculate_protocol_fee(amount, protocol_fee_bps)?;

    // Calculate net amount
    let net_amount = amount
        .checked_sub(platform_fee)
        .and_then(|v| v.checked_sub(protocol_fee))
        .ok_or(ContractError::Overflow)?;

    let breakdown = FeeBreakdown {
        amount,
        platform_fee,
        protocol_fee,
        net_amount,
        corridor: corridor_id,
    };

    // Validate breakdown consistency
    breakdown.validate()?;

    Ok(breakdown)
}

/// Calculates complete fee breakdown for a sender using rolling volume discounts.
pub fn calculate_fees_with_breakdown_for_sender(
    env: &Env,
    sender: &Address,
    amount: i128,
    token: Option<&Address>,
    corridor: Option<&FeeCorridor>,
) -> Result<FeeBreakdown, ContractError> {
    if amount <= 0 {
        return Err(ContractError::InvalidAmount);
    }

    // Determine which strategy and protocol fee to use
    let (strategy, protocol_fee_bps, corridor_id) = if let Some(c) = corridor {
        let protocol_bps = c
            .protocol_fee_bps
            .unwrap_or_else(|| get_protocol_fee_bps(env));
        let id = format_corridor_id(env, &c.from_country, &c.to_country);
        (c.strategy.clone(), protocol_bps, Some(id))
    } else {
        (get_fee_strategy(env), get_protocol_fee_bps(env), None)
    };

    let effective_strategy = get_effective_fee_strategy_for_strategy(env, &strategy, token)?;
    let prior_volume = storage::get_sender_rolling_volume(env, sender, env.ledger().timestamp());
    let total_volume = prior_volume
        .checked_add(amount)
        .ok_or(ContractError::Overflow)?;
    let discounted_strategy = apply_volume_discount(total_volume, effective_strategy)?;

    // Calculate platform fee
    let platform_fee = calculate_fee_by_strategy(amount, &discounted_strategy)?;

    // Calculate protocol fee
    let protocol_fee = calculate_protocol_fee(amount, protocol_fee_bps)?;

    // Calculate net amount
    let net_amount = amount
        .checked_sub(platform_fee)
        .and_then(|v| v.checked_sub(protocol_fee))
        .ok_or(ContractError::Overflow)?;

    let breakdown = FeeBreakdown {
        amount,
        platform_fee,
        protocol_fee,
        net_amount,
        corridor: corridor_id,
    };

    breakdown.validate()?;
    Ok(breakdown)
}

fn apply_volume_discount(total_volume: i128, strategy: FeeStrategy) -> Result<FeeStrategy, ContractError> {
    match strategy {
        FeeStrategy::Percentage(base_fee_bps) => {
            let discounted_bps = get_discounted_fee_bps(total_volume, base_fee_bps);
            Ok(FeeStrategy::Percentage(discounted_bps))
        }
        other => Ok(other),
    }
}

fn get_discounted_fee_bps(total_volume: i128, base_fee_bps: u32) -> u32 {
    let tiers: &[(i128, u32)] = &[
        (SENDER_VOLUME_TIER_THRESHOLD_10K, SENDER_VOLUME_TIER_FEE_BPS_10K),
    ];

    let mut fee_bps = base_fee_bps;
    for (threshold, tier_bps) in tiers.iter().rev() {
        if total_volume >= *threshold {
            fee_bps = fee_bps.min(*tier_bps);
            break;
        }
    }
    fee_bps
}

fn get_effective_fee_strategy(
    env: &Env,
    token: Option<&Address>,
) -> Result<FeeStrategy, ContractError> {
    let strategy = get_fee_strategy(env);
    get_effective_fee_strategy_for_strategy(env, &strategy, token)
}

fn get_effective_fee_strategy_for_strategy(
    env: &Env,
    strategy: &FeeStrategy,
    token: Option<&Address>,
) -> Result<FeeStrategy, ContractError> {
    match strategy {
        FeeStrategy::Percentage(_) => {
            if let Some(token) = token {
                let default_fee_bps = get_platform_fee_bps(env)?;
                let fee_bps = storage::get_token_fee_bps(env, token).unwrap_or(default_fee_bps);
                Ok(FeeStrategy::Percentage(fee_bps))
            } else {
                Ok(strategy.clone())
            }
        }
        // Corridor variant: resolve to the platform percentage fee.
        // Actual corridor dispatch happens in calculate_fees_with_breakdown
        // when a FeeCorridor is supplied by the caller.
        FeeStrategy::Corridor => {
            let default_fee_bps = get_platform_fee_bps(env)?;
            let fee_bps = if let Some(token) = token {
                storage::get_token_fee_bps(env, token).unwrap_or(default_fee_bps)
            } else {
                default_fee_bps
            };
            Ok(FeeStrategy::Percentage(fee_bps))
        }
        _ => Ok(strategy.clone()),
    }
}

/// Calculates fee based on the specified strategy.
///
/// # Arguments
///
/// * `amount` - Transaction amount
/// * `strategy` - Fee strategy to apply
///
/// # Returns
///
/// * `Ok(i128)` - Calculated fee
/// * `Err(ContractError::Overflow)` - Arithmetic overflow
fn calculate_fee_by_strategy(amount: i128, strategy: &FeeStrategy) -> Result<i128, ContractError> {
    match strategy {
        FeeStrategy::Percentage(fee_bps) => {
            // Fee = amount * fee_bps / 10000, with a minimum of MIN_FEE stroop
            let fee = amount
                .checked_mul(*fee_bps as i128)
                .and_then(|v| v.checked_div(FEE_DIVISOR))
                .ok_or(ContractError::Overflow)?;
            Ok(fee.max(MIN_FEE))
        }
        FeeStrategy::Flat(fee_amount) => {
            // Fixed fee regardless of amount
            Ok(*fee_amount)
        }
        FeeStrategy::Dynamic(base_fee_bps) => {
            // Dynamic tiered fee: decreases for larger amounts
            // Tier 1: < 1000 -> base_fee_bps
            // Tier 2: 1000-10000 -> base_fee_bps * 0.8
            // Tier 3: > 10000 -> base_fee_bps * 0.6
            let effective_bps = if amount < 1000_0000000 {
                // Tier 1: Full fee
                *base_fee_bps
            } else if amount < 10000_0000000 {
                // Tier 2: 80% of base fee
                (*base_fee_bps * 80) / 100
            } else {
                // Tier 3: 60% of base fee
                (*base_fee_bps * 60) / 100
            };

            let fee = amount
                .checked_mul(effective_bps as i128)
                .and_then(|v| v.checked_div(FEE_DIVISOR))
                .ok_or(ContractError::Overflow)?;
            Ok(fee.max(MIN_FEE))
        }
        // Corridor is resolved to Percentage before reaching this function.
        // If it somehow arrives here, treat as zero fee (safe fallback).
        FeeStrategy::Corridor => Ok(MIN_FEE),
    }
}

/// Calculates protocol fee for treasury.
///
/// # Arguments
///
/// * `amount` - Transaction amount
/// * `protocol_fee_bps` - Protocol fee in basis points
///
/// # Returns
///
/// * `Ok(i128)` - Calculated protocol fee
/// * `Err(ContractError::Overflow)` - Arithmetic overflow
fn calculate_protocol_fee(amount: i128, protocol_fee_bps: u32) -> Result<i128, ContractError> {
    if protocol_fee_bps == 0 {
        return Ok(0);
    }

    let fee = amount
        .checked_mul(protocol_fee_bps as i128)
        .and_then(|v| v.checked_div(FEE_DIVISOR))
        .ok_or(ContractError::Overflow)?;
    Ok(fee)
}

/// Formats a corridor identifier string.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `from_country` - Source country code
/// * `to_country` - Destination country code
///
/// # Returns
///
/// Formatted corridor ID (e.g., "US-MX")
fn format_corridor_id(env: &Env, from_country: &String, to_country: &String) -> String {
    // Create corridor ID as "FROM-TO" using simple approach
    // Convert Soroban strings to regular strings for manipulation
    let from_str = from_country.to_string();
    let to_str = to_country.to_string();

    // Create the combined string manually
    let combined = from_str + "-" + &to_str;

    // Convert back to Soroban String
    String::from_str(env, &combined)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{Env, String};

    // Include property-based tests
    #[cfg(test)]
    mod property_tests;

    // Re-export the calculate_fee_by_strategy function for property tests
    pub(crate) use super::calculate_fee_by_strategy;
    pub(crate) use super::calculate_protocol_fee;
    pub(crate) use super::format_corridor_id;

    #[test]
    fn test_calculate_fee_percentage() {
        let strategy = FeeStrategy::Percentage(250); // 2.5%
        let amount = 10000i128;

        let fee = calculate_fee_by_strategy(amount, &strategy).unwrap();
        assert_eq!(fee, 250); // 10000 * 250 / 10000 = 250
    }

    #[test]
    fn test_calculate_fee_percentage_small_amount_floor() {
        // 300 stroops * 250 bps / 10000 = 7.5 → truncates to 7, but floor is 1
        // For amount < 400 stroops at 250 bps the raw result is 0 → floor kicks in
        let strategy = FeeStrategy::Percentage(250); // 2.5%
        let amount = 300i128; // 300 * 250 / 10000 = 7 (still > 0 here)

        let fee = calculate_fee_by_strategy(amount, &strategy).unwrap();
        assert!(fee >= 1, "fee must be at least MIN_FEE");

        // Truly truncating case: 1 stroop * 250 bps / 10000 = 0 → floor to 1
        let tiny_fee = calculate_fee_by_strategy(1, &strategy).unwrap();
        assert_eq!(tiny_fee, 1);
    }

    #[test]
    fn test_calculate_fee_flat() {
        let strategy = FeeStrategy::Flat(100);
        let amount = 10000i128;

        let fee = calculate_fee_by_strategy(amount, &strategy).unwrap();
        assert_eq!(fee, 100);
    }

    #[test]
    fn test_calculate_fee_dynamic_tier1() {
        let strategy = FeeStrategy::Dynamic(400); // 4% base
        let amount = 500_0000000i128; // Tier 1: < 1000

        let fee = calculate_fee_by_strategy(amount, &strategy).unwrap();
        // 500 * 400 / 10000 = 20
        assert_eq!(fee, 20_0000000);
    }

    #[test]
    fn test_calculate_fee_dynamic_tier2() {
        let strategy = FeeStrategy::Dynamic(400); // 4% base
        let amount = 5000_0000000i128; // Tier 2: 1000-10000

        let fee = calculate_fee_by_strategy(amount, &strategy).unwrap();
        // 5000 * (400 * 0.8) / 10000 = 5000 * 320 / 10000 = 160
        assert_eq!(fee, 160_0000000);
    }

    #[test]
    fn test_calculate_fee_dynamic_tier3() {
        let strategy = FeeStrategy::Dynamic(400); // 4% base
        let amount = 20000_0000000i128; // Tier 3: > 10000

        let fee = calculate_fee_by_strategy(amount, &strategy).unwrap();
        // 20000 * (400 * 0.6) / 10000 = 20000 * 240 / 10000 = 480
        assert_eq!(fee, 480_0000000);
    }

    #[test]
    fn test_calculate_protocol_fee() {
        let amount = 10000i128;
        let protocol_fee_bps = 50u32; // 0.5%

        let fee = calculate_protocol_fee(amount, protocol_fee_bps).unwrap();
        assert_eq!(fee, 50); // 10000 * 50 / 10000 = 50
    }

    #[test]
    fn test_calculate_protocol_fee_zero() {
        let amount = 10000i128;
        let protocol_fee_bps = 0u32;

        let fee = calculate_protocol_fee(amount, protocol_fee_bps).unwrap();
        assert_eq!(fee, 0);
    }

    #[test]
    fn test_fee_breakdown_validation_success() {
        let breakdown = FeeBreakdown {
            amount: 1000,
            platform_fee: 25,
            protocol_fee: 5,
            net_amount: 970,
            corridor: None,
        };

        assert!(breakdown.validate().is_ok());
    }

    #[test]
    fn test_fee_breakdown_validation_failure() {
        let breakdown = FeeBreakdown {
            amount: 1000,
            platform_fee: 25,
            protocol_fee: 5,
            net_amount: 900, // Wrong! Should be 970
            corridor: None,
        };

        assert!(breakdown.validate().is_err());
    }

    #[test]
    fn test_fee_breakdown_negative_values() {
        let breakdown = FeeBreakdown {
            amount: 1000,
            platform_fee: -25,
            protocol_fee: 5,
            net_amount: 1020,
            corridor: None,
        };

        assert!(breakdown.validate().is_err());
    }

    #[test]
    fn test_format_corridor_id_us_mx() {
        let env = Env::default();
        let from = String::from_str(&env, "US");
        let to = String::from_str(&env, "MX");

        let corridor_id = format_corridor_id(&env, &from, &to);
        assert_eq!(corridor_id, String::from_str(&env, "US-MX"));
    }

    #[test]
    fn test_format_corridor_id_mx_us() {
        let env = Env::default();
        let from = String::from_str(&env, "MX");
        let to = String::from_str(&env, "US");

        let corridor_id = format_corridor_id(&env, &from, &to);
        assert_eq!(corridor_id, String::from_str(&env, "MX-US"));
    }

    #[test]
    fn test_format_corridor_id_gb_ng() {
        let env = Env::default();
        let from = String::from_str(&env, "GB");
        let to = String::from_str(&env, "NG");

        let corridor_id = format_corridor_id(&env, &from, &to);
        assert_eq!(corridor_id, String::from_str(&env, "GB-NG"));
    }
}
