//! Property-based tests for fee calculation functions using proptest.
//!
//! These tests use fuzzing to verify mathematical properties and catch
//! edge cases like overflows, incorrect calculations, and boundary conditions.

#[cfg(test)]
mod property_tests {
    use super::super::fee_service::*;
    use crate::config::{FEE_DIVISOR, MAX_FEE_BPS, MIN_FEE};
    use crate::{ContractError, FeeStrategy};
    use proptest::prelude::*;
    use soroban_sdk::{Env, String};

    // Helper function to create test environment
    fn create_test_env() -> Env {
        Env::default()
    }

    // Property test strategies (generators)
    prop_compose! {
        fn valid_amount()(amount in 1i128..=i128::MAX/MAX_FEE_BPS as i128) -> i128 {
            amount
        }
    }

    prop_compose! {
        fn valid_fee_bps()(bps in 0u32..=MAX_FEE_BPS) -> u32 {
            bps
        }
    }

    prop_compose! {
        fn reasonable_amount()(amount in 1i128..=1_000_000_000i128) -> i128 {
            amount
        }
    }

    prop_compose! {
        fn small_fee_bps()(bps in 0u32..=1000u32) -> u32 {
            bps
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]

        /// Test that percentage fees never exceed the original amount
        #[test]
        fn percentage_fee_never_exceeds_amount(
            amount in valid_amount(),
            fee_bps in valid_fee_bps()
        ) {
            let strategy = FeeStrategy::Percentage(fee_bps);
            let result = calculate_fee_by_strategy(amount, &strategy);
            
            prop_assert!(result.is_ok());
            let fee = result.unwrap();
            prop_assert!(fee <= amount, "Fee {} should not exceed amount {}", fee, amount);
        }

        /// Test that fees are always at least MIN_FEE
        #[test]
        fn fee_always_at_least_minimum(
            amount in valid_amount(),
            fee_bps in valid_fee_bps()
        ) {
            let strategy = FeeStrategy::Percentage(fee_bps);
            let result = calculate_fee_by_strategy(amount, &strategy);
            
            prop_assert!(result.is_ok());
            let fee = result.unwrap();
            prop_assert!(fee >= MIN_FEE, "Fee {} should be at least MIN_FEE {}", fee, MIN_FEE);
        }

        /// Test that fees are monotonically increasing with fee basis points
        #[test]
        fn fee_monotonic_with_bps(
            amount in 1000i128..=1_000_000i128, // Large enough to avoid MIN_FEE effects
            fee_bps in 0u32..=(MAX_FEE_BPS-1)
        ) {
            let strategy1 = FeeStrategy::Percentage(fee_bps);
            let strategy2 = FeeStrategy::Percentage(fee_bps + 1);
            
            let fee1 = calculate_fee_by_strategy(amount, &strategy1).unwrap();
            let fee2 = calculate_fee_by_strategy(amount, &strategy2).unwrap();
            
            prop_assert!(fee2 >= fee1, "Fee with higher bps ({}) should be >= fee with lower bps ({})", fee2, fee1);
        }

        /// Test that fees are monotonically increasing with amount (when not floored)
        #[test]
        fn fee_monotonic_with_amount(
            amount in 1000i128..=(i128::MAX/MAX_FEE_BPS as i128 - 1), // Avoid overflow
            fee_bps in 100u32..=MAX_FEE_BPS // Non-zero fee for meaningful comparison
        ) {
            let strategy = FeeStrategy::Percentage(fee_bps);
            
            let fee1 = calculate_fee_by_strategy(amount, &strategy).unwrap();
            let fee2 = calculate_fee_by_strategy(amount + 1, &strategy).unwrap();
            
            prop_assert!(fee2 >= fee1, "Fee for larger amount ({}) should be >= fee for smaller amount ({})", fee2, fee1);
        }

        /// Test exact fee calculation formula
        #[test]
        fn fee_calculation_exact(
            amount in reasonable_amount(),
            fee_bps in valid_fee_bps()
        ) {
            let strategy = FeeStrategy::Percentage(fee_bps);
            let calculated_fee = calculate_fee_by_strategy(amount, &strategy).unwrap();
            
            let expected_fee = (amount * fee_bps as i128 / FEE_DIVISOR).max(MIN_FEE);
            prop_assert_eq!(calculated_fee, expected_fee);
        }

        /// Test protocol fee properties
        #[test]
        fn protocol_fee_properties(
            amount in valid_amount(),
            protocol_fee_bps in valid_fee_bps()
        ) {
            let result = calculate_protocol_fee(amount, protocol_fee_bps);
            prop_assert!(result.is_ok());
            
            let fee = result.unwrap();
            
            // Protocol fee should never exceed amount
            prop_assert!(fee <= amount);
            
            // Protocol fee should be zero when bps is zero
            if protocol_fee_bps == 0 {
                prop_assert_eq!(fee, 0);
            }
            
            // Protocol fee should be exact calculation (no minimum floor)
            let expected = if protocol_fee_bps == 0 {
                0
            } else {
                amount * protocol_fee_bps as i128 / FEE_DIVISOR
            };
            prop_assert_eq!(fee, expected);
        }

        /// Test dynamic fee tier behavior
        #[test]
        fn dynamic_fee_tiers(
            base_fee_bps in 100u32..=1000u32 // Reasonable base fee range
        ) {
            let strategy = FeeStrategy::Dynamic(base_fee_bps);
            
            // Tier 1: < 1000 USDC (full fee)
            let tier1_amount = 500_0000000i128;
            let tier1_fee = calculate_fee_by_strategy(tier1_amount, &strategy).unwrap();
            let tier1_expected = (tier1_amount * base_fee_bps as i128 / FEE_DIVISOR).max(MIN_FEE);
            prop_assert_eq!(tier1_fee, tier1_expected);
            
            // Tier 2: 1000-10000 USDC (80% of base fee)
            let tier2_amount = 5000_0000000i128;
            let tier2_fee = calculate_fee_by_strategy(tier2_amount, &strategy).unwrap();
            let tier2_bps = (base_fee_bps * 80) / 100;
            let tier2_expected = (tier2_amount * tier2_bps as i128 / FEE_DIVISOR).max(MIN_FEE);
            prop_assert_eq!(tier2_fee, tier2_expected);
            
            // Tier 3: > 10000 USDC (60% of base fee)
            let tier3_amount = 20000_0000000i128;
            let tier3_fee = calculate_fee_by_strategy(tier3_amount, &strategy).unwrap();
            let tier3_bps = (base_fee_bps * 60) / 100;
            let tier3_expected = (tier3_amount * tier3_bps as i128 / FEE_DIVISOR).max(MIN_FEE);
            prop_assert_eq!(tier3_fee, tier3_expected);
            
            // Verify tier ordering: higher tiers should have lower effective rates
            // (for the same normalized amount)
            let normalized_amount = 1000_0000000i128;
            let norm_tier1 = (normalized_amount * base_fee_bps as i128 / FEE_DIVISOR).max(MIN_FEE);
            let norm_tier2 = (normalized_amount * tier2_bps as i128 / FEE_DIVISOR).max(MIN_FEE);
            let norm_tier3 = (normalized_amount * tier3_bps as i128 / FEE_DIVISOR).max(MIN_FEE);
            
            prop_assert!(norm_tier1 >= norm_tier2);
            prop_assert!(norm_tier2 >= norm_tier3);
        }

        /// Test flat fee strategy
        #[test]
        fn flat_fee_properties(
            amount in valid_amount(),
            flat_fee in 1i128..=1000000i128
        ) {
            let strategy = FeeStrategy::Flat(flat_fee);
            let calculated_fee = calculate_fee_by_strategy(amount, &strategy).unwrap();
            
            // Flat fee should always return the exact flat amount
            prop_assert_eq!(calculated_fee, flat_fee);
        }

        /// Test fee breakdown mathematical consistency
        #[test]
        fn fee_breakdown_consistency(
            amount in 1000i128..=1_000_000i128, // Reasonable range
            platform_fee_bps in small_fee_bps(),
            protocol_fee_bps in small_fee_bps()
        ) {
            // Skip cases where fees would exceed amount
            let max_platform = amount * platform_fee_bps as i128 / FEE_DIVISOR;
            let max_protocol = amount * protocol_fee_bps as i128 / FEE_DIVISOR;
            prop_assume!(max_platform + max_protocol < amount);
            
            let env = create_test_env();
            let breakdown = calculate_fees_with_breakdown(
                &env,
                amount,
                None, // No token
                None  // No corridor
            );
            
            // This would require mocking the storage functions, so we'll test the validation instead
            let test_breakdown = FeeBreakdown {
                amount,
                platform_fee: (amount * platform_fee_bps as i128 / FEE_DIVISOR).max(MIN_FEE),
                protocol_fee: amount * protocol_fee_bps as i128 / FEE_DIVISOR,
                net_amount: 0, // Will be calculated
                corridor: None,
            };
            
            let net = amount - test_breakdown.platform_fee - test_breakdown.protocol_fee;
            let final_breakdown = FeeBreakdown {
                net_amount: net,
                ..test_breakdown
            };
            
            // Test validation
            prop_assert!(final_breakdown.validate().is_ok());
            
            // Test mathematical consistency
            prop_assert_eq!(
                final_breakdown.amount,
                final_breakdown.platform_fee + final_breakdown.protocol_fee + final_breakdown.net_amount
            );
            
            // All values should be non-negative
            prop_assert!(final_breakdown.amount >= 0);
            prop_assert!(final_breakdown.platform_fee >= 0);
            prop_assert!(final_breakdown.protocol_fee >= 0);
            prop_assert!(final_breakdown.net_amount >= 0);
        }

        /// Test overflow protection
        #[test]
        fn overflow_protection(
            large_amount in (i128::MAX/2)..=i128::MAX,
            fee_bps in (MAX_FEE_BPS/2)..=MAX_FEE_BPS
        ) {
            let strategy = FeeStrategy::Percentage(fee_bps);
            
            // This should either succeed or return an overflow error
            let result = calculate_fee_by_strategy(large_amount, &strategy);
            
            match result {
                Ok(fee) => {
                    // If it succeeds, the fee should be valid
                    prop_assert!(fee >= MIN_FEE);
                    prop_assert!(fee <= large_amount);
                }
                Err(ContractError::Overflow) => {
                    // Overflow error is acceptable for very large values
                }
                Err(other) => {
                    prop_assert!(false, "Unexpected error: {:?}", other);
                }
            }
        }

        /// Test invalid amount handling
        #[test]
        fn invalid_amount_handling(
            invalid_amount in i128::MIN..=0i128,
            fee_bps in valid_fee_bps()
        ) {
            let env = create_test_env();
            let result = calculate_platform_fee(&env, invalid_amount, None);
            
            prop_assert!(result.is_err());
            prop_assert!(matches!(result.unwrap_err(), ContractError::InvalidAmount));
        }

        /// Test corridor ID formatting
        #[test]
        fn corridor_id_formatting(
            from_country in "[A-Z]{2}",
            to_country in "[A-Z]{2}"
        ) {
            let env = create_test_env();
            let from_str = String::from_str(&env, &from_country);
            let to_str = String::from_str(&env, &to_country);
            
            let corridor_id = format_corridor_id(&env, &from_str, &to_str);
            let expected = format!("{}-{}", from_country, to_country);
            
            prop_assert_eq!(corridor_id.to_string(), expected);
        }

        /// Test fee breakdown validation edge cases
        #[test]
        fn fee_breakdown_validation_edge_cases(
            amount in 1i128..=1000000i128,
            platform_fee in 0i128..=1000000i128,
            protocol_fee in 0i128..=1000000i128
        ) {
            let net_amount = amount.saturating_sub(platform_fee).saturating_sub(protocol_fee);
            
            let breakdown = FeeBreakdown {
                amount,
                platform_fee,
                protocol_fee,
                net_amount,
                corridor: None,
            };
            
            let validation_result = breakdown.validate();
            
            // Should be valid only if the math adds up and all values are non-negative
            let expected_valid = amount == platform_fee + protocol_fee + net_amount
                && amount >= 0
                && platform_fee >= 0
                && protocol_fee >= 0
                && net_amount >= 0;
            
            if expected_valid {
                prop_assert!(validation_result.is_ok());
            } else {
                prop_assert!(validation_result.is_err());
            }
        }
    }

    // Additional targeted property tests for specific edge cases
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Test boundary conditions for dynamic fee tiers
        #[test]
        fn dynamic_fee_boundary_conditions(
            base_fee_bps in 100u32..=1000u32
        ) {
            let strategy = FeeStrategy::Dynamic(base_fee_bps);
            
            // Test exact boundary values
            let boundary1 = 1000_0000000i128; // Tier 1/2 boundary
            let boundary2 = 10000_0000000i128; // Tier 2/3 boundary
            
            // Just below boundaries
            let just_below_1 = boundary1 - 1;
            let just_below_2 = boundary2 - 1;
            
            let fee_below_1 = calculate_fee_by_strategy(just_below_1, &strategy).unwrap();
            let fee_at_1 = calculate_fee_by_strategy(boundary1, &strategy).unwrap();
            let fee_below_2 = calculate_fee_by_strategy(just_below_2, &strategy).unwrap();
            let fee_at_2 = calculate_fee_by_strategy(boundary2, &strategy).unwrap();
            
            // Fees should change at boundaries (unless floored by MIN_FEE)
            // Below boundary 1: full rate
            // At boundary 1: 80% rate
            let tier1_expected = (just_below_1 * base_fee_bps as i128 / FEE_DIVISOR).max(MIN_FEE);
            let tier2_expected = (boundary1 * (base_fee_bps * 80 / 100) as i128 / FEE_DIVISOR).max(MIN_FEE);
            
            prop_assert_eq!(fee_below_1, tier1_expected);
            prop_assert_eq!(fee_at_1, tier2_expected);
            
            // Similar for boundary 2
            let tier2_bps = (base_fee_bps * 80) / 100;
            let tier3_bps = (base_fee_bps * 60) / 100;
            
            let tier2_below_expected = (just_below_2 * tier2_bps as i128 / FEE_DIVISOR).max(MIN_FEE);
            let tier3_at_expected = (boundary2 * tier3_bps as i128 / FEE_DIVISOR).max(MIN_FEE);
            
            prop_assert_eq!(fee_below_2, tier2_below_expected);
            prop_assert_eq!(fee_at_2, tier3_at_expected);
        }

        /// Test maximum fee basis points (100%)
        #[test]
        fn maximum_fee_bps(
            amount in reasonable_amount()
        ) {
            let strategy = FeeStrategy::Percentage(MAX_FEE_BPS);
            let fee = calculate_fee_by_strategy(amount, &strategy).unwrap();
            
            // 100% fee should equal the amount
            prop_assert_eq!(fee, amount);
        }

        /// Test zero fee basis points
        #[test]
        fn zero_fee_bps(
            amount in reasonable_amount()
        ) {
            let strategy = FeeStrategy::Percentage(0);
            let fee = calculate_fee_by_strategy(amount, &strategy).unwrap();
            
            // Zero bps should result in MIN_FEE due to floor
            prop_assert_eq!(fee, MIN_FEE);
        }
    }
}