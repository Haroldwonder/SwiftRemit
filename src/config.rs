//! Centralized configuration constants for the SwiftRemit contract.
//!
//! This module defines all contract-wide constants to ensure consistency
//! and prevent duplicate definitions. All magic numbers should be defined
//! here with clear documentation.

// ============================================================================
// Batch Processing Limits
// ============================================================================

/// Maximum number of remittances that can be settled in a single batch operation.
///
/// This limit prevents excessive resource consumption during batch settlement
/// operations. Used by batch settlement functions to validate input size.
pub const MAX_BATCH_SIZE: u32 = 100;

/// Maximum number of expired remittances that can be processed in a single batch.
///
/// This limit prevents excessive resource consumption during expired remittance
/// cleanup operations. Set lower than MAX_BATCH_SIZE due to additional processing
/// overhead for expiry checks and refunds.
pub const MAX_EXPIRED_BATCH_SIZE: u32 = 50;

/// Maximum number of items that can be exported/imported in a single migration batch.
///
/// This limit prevents excessive resource consumption during contract migration
/// operations. Used by migration export/import functions to validate batch size.
pub const MAX_MIGRATION_BATCH_SIZE: u32 = 100;

// ============================================================================
// Fee Calculation Constants
// ============================================================================

/// Maximum allowed fee in basis points (100% = 10000 bps).
///
/// This limit prevents accidentally setting fees above 100%.
/// Used in initialize() and update_fee() for validation.
/// - 1 bps = 0.01%
/// - 100 bps = 1%
/// - 10000 bps = 100%
pub const MAX_FEE_BPS: u32 = 10000;

/// Divisor for converting basis points to actual fee amounts.
///
/// Formula: fee_amount = amount * fee_bps / FEE_DIVISOR
/// Used in fee calculation functions throughout the contract.
/// - Value: 10000 (basis points scale)
pub const FEE_DIVISOR: i128 = 10000;

// ============================================================================
// Rate Limiting Configuration
// ============================================================================

/// Default maximum number of requests allowed per rate limit window.
///
/// Used during rate limit initialization to set the default request limit.
/// Can be updated by admin via update_rate_limit().
pub const DEFAULT_RATE_LIMIT_MAX_REQUESTS: u32 = 100;

/// Default rate limit window duration in seconds.
///
/// Used during rate limit initialization to set the default time window.
/// Can be updated by admin via update_rate_limit().
/// - Value: 60 seconds (1 minute)
pub const DEFAULT_RATE_LIMIT_WINDOW_SECONDS: u64 = 60;

// ============================================================================
// Daily Send Limits
// ============================================================================

/// Daily send limit rolling window duration in seconds.
///
/// Used to enforce daily sending limits per user. Transactions within this
/// window are counted toward the daily limit.
/// - Value: 86400 seconds (24 hours)
pub const DAILY_LIMIT_WINDOW_SECONDS: u64 = 24 * 60 * 60;

/// Default currency code for daily send limits.
///
/// Used when no specific currency is provided for daily limit checks.
/// - Value: "USDC" (USD Coin)
pub const DEFAULT_DAILY_LIMIT_CURRENCY: &str = "USDC";

/// Default country code for daily send limits.
///
/// Used when no specific country is provided for daily limit checks.
/// - Value: "GLOBAL" (applies to all countries)
pub const DEFAULT_DAILY_LIMIT_COUNTRY: &str = "GLOBAL";

// ============================================================================
// Storage and Event Schema
// ============================================================================

/// Schema version for event structures.
///
/// Used to track event format versions for forward compatibility.
/// Increment when making breaking changes to event structures.
pub const SCHEMA_VERSION: u32 = 1;

/// Flag indicating a settlement has been executed.
///
/// Used in storage to mark settlements as completed and prevent duplicates.
pub const SETTLEMENT_EXECUTED_FLAG: u32 = 1;

/// Flag indicating a settlement event has been emitted.
///
/// Used in storage to track event emission status.
pub const SETTLEMENT_EVENT_EMITTED_FLAG: u32 = 1 << 1;

// ============================================================================
// Migration Configuration
// ============================================================================

/// Migration snapshot version for forward compatibility.
///
/// Used to track migration snapshot format versions. Increment when making
/// breaking changes to migration data structures.
pub const MIGRATION_SNAPSHOT_VERSION: u32 = 1;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_size_constants() {
        assert!(MAX_BATCH_SIZE > 0);
        assert!(MAX_EXPIRED_BATCH_SIZE > 0);
        assert!(MAX_MIGRATION_BATCH_SIZE > 0);
        assert!(MAX_EXPIRED_BATCH_SIZE <= MAX_BATCH_SIZE);
    }

    #[test]
    fn test_fee_constants() {
        assert_eq!(MAX_FEE_BPS, 10000);
        assert_eq!(FEE_DIVISOR, 10000);
    }

    #[test]
    fn test_rate_limit_constants() {
        assert!(DEFAULT_RATE_LIMIT_MAX_REQUESTS > 0);
        assert!(DEFAULT_RATE_LIMIT_WINDOW_SECONDS > 0);
    }

    #[test]
    fn test_daily_limit_constants() {
        assert_eq!(DAILY_LIMIT_WINDOW_SECONDS, 86400);
        assert_eq!(DEFAULT_DAILY_LIMIT_CURRENCY, "USDC");
        assert_eq!(DEFAULT_DAILY_LIMIT_COUNTRY, "GLOBAL");
    }

    #[test]
    fn test_schema_version() {
        assert!(SCHEMA_VERSION > 0);
    }

    #[test]
    fn test_settlement_flags() {
        assert_eq!(SETTLEMENT_EXECUTED_FLAG, 1);
        assert_eq!(SETTLEMENT_EVENT_EMITTED_FLAG, 2);
        // Ensure flags don't overlap
        assert_eq!(SETTLEMENT_EXECUTED_FLAG & SETTLEMENT_EVENT_EMITTED_FLAG, 0);
    }
}
