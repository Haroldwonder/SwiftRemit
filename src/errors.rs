//! Error types for the SwiftRemit contract.
//!
//! This module defines all possible error conditions that can occur
//! during contract execution. All errors are explicitly defined with
//! unique error codes to ensure deterministic error handling.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    // ═══════════════════════════════════════════════════════════════════════════
    // Initialization Errors (1-2)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Contract has already been initialized.
    /// Cause: Attempting to call initialize() on an already initialized contract.
    AlreadyInitialized = 1,

    /// Contract has not been initialized yet.
    /// Cause: Attempting operations before calling initialize().
    NotInitialized = 2,

    // ═══════════════════════════════════════════════════════════════════════════
    // Validation Errors (3-10)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Amount must be greater than zero.
    /// Cause: Providing zero or negative amount in remittance creation.
    InvalidAmount = 3,

    /// Fee must be between 0 and 10000 basis points (0-100%).
    /// Cause: Setting platform fee outside valid range.
    InvalidFeeBps = 4,

    /// Agent is not registered in the system.
    /// Cause: Attempting to create remittance with unregistered agent.
    AgentNotRegistered = 5,

    /// Remittance not found.
    /// Cause: Querying or operating on non-existent remittance ID.
    RemittanceNotFound = 6,

    /// Invalid remittance status for this operation.
    /// Cause: Attempting operation on remittance in wrong status (e.g., settling completed remittance).
    InvalidStatus = 7,

    /// Invalid state transition attempted.
    /// Cause: Attempting to transition remittance to invalid state.
    InvalidStateTransition = 8,

    /// No fees available to withdraw.
    /// Cause: Attempting to withdraw fees when accumulated fees is zero or negative.
    NoFeesToWithdraw = 9,

    /// Invalid address format or validation failed.
    /// Cause: Address does not meet validation requirements.
    InvalidAddress = 10,

    // ═══════════════════════════════════════════════════════════════════════════
    // Settlement Errors (11-12)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Settlement window has expired.
    /// Cause: Attempting to settle remittance after expiry timestamp.
    SettlementExpired = 11,

    /// Settlement has already been executed.
    /// Cause: Attempting to settle the same remittance twice (duplicate prevention).
    DuplicateSettlement = 12,

    // ═══════════════════════════════════════════════════════════════════════════
    // Contract State & User Errors (13-22)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Contract is paused. Settlements are temporarily disabled.
    /// Cause: Attempting confirm_payout() while contract is in paused state.
    ContractPaused = 13,

    /// Asset verification record not found.
    AssetNotFound = 14,

    /// User is blacklisted and cannot perform transactions.
    /// Cause: User address is on the blacklist.
    UserBlacklisted = 15,

    /// Reputation score must be between 0 and 100.
    InvalidReputationScore = 16,

    /// User KYC is not approved.
    /// Cause: User has not completed KYC verification.
    KycNotApproved = 17,

    /// Asset has been flagged as suspicious.
    SuspiciousAsset = 18,

    /// Anchor transaction failed.
    /// Cause: Anchor withdrawal/deposit operation failed.
    AnchorTransactionFailed = 19,

    /// Caller is not authorized to perform admin operations.
    /// Cause: Non-admin attempting to perform admin-only operations.
    Unauthorized = 20,

    /// Daily send limit exceeded for this user.
    /// Cause: User's total transfers in the last 24 hours exceed the configured limit.
    DailySendLimitExceeded = 21,

    /// Token is already whitelisted in the system.
    /// Cause: Attempting to add a token that is already whitelisted.
    TokenAlreadyWhitelisted = 22,

    // ═══════════════════════════════════════════════════════════════════════════
    // KYC / Transaction Errors (23-25)
    // ═══════════════════════════════════════════════════════════════════════════

    /// User KYC has expired.
    /// Cause: User's KYC verification has expired and needs renewal.
    KycExpired = 23,

    /// Transaction record not found.
    /// Cause: Querying non-existent transaction record.
    TransactionNotFound = 24,

    /// Rate limit exceeded.
    RateLimitExceeded = 25,

    // ═══════════════════════════════════════════════════════════════════════════
    // Authorization Errors (26-29)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Admin address already exists in the system.
    /// Cause: Attempting to add an admin that is already registered.
    AdminAlreadyExists = 26,

    /// Admin address does not exist in the system.
    /// Cause: Attempting to remove an admin that is not registered.
    AdminNotFound = 27,

    /// Cannot remove the last admin from the system.
    /// Cause: Attempting to remove the only remaining admin.
    CannotRemoveLastAdmin = 28,

    // ═══════════════════════════════════════════════════════════════════════════
    // Token Whitelist Errors (29)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Token is not whitelisted for use in the system.
    /// Cause: Attempting to initialize contract with non-whitelisted token.
    TokenNotWhitelisted = 29,

    // ═══════════════════════════════════════════════════════════════════════════
    // Migration Errors (30-32)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Migration hash verification failed.
    /// Cause: Snapshot hash doesn't match computed hash (data tampering or corruption).
    InvalidMigrationHash = 30,

    /// Migration already in progress or completed.
    /// Cause: Attempting to start migration when one is already active.
    MigrationInProgress = 31,

    /// Migration batch out of order or invalid.
    /// Cause: Importing batches in wrong order or invalid batch number.
    InvalidMigrationBatch = 32,

    // ═══════════════════════════════════════════════════════════════════════════
    // Rate Limiting / Abuse Errors (33-36)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Cooldown period is still active.
    /// Cause: Attempting action before cooldown period has elapsed.
    CooldownActive = 33,

    /// Suspicious activity detected.
    /// Cause: Pattern matching known abuse behaviors (rapid retries, unusual patterns).
    SuspiciousActivity = 34,

    /// Action temporarily blocked due to abuse protection.
    /// Cause: Multiple violations or severe abuse detected.
    ActionBlocked = 35,

    // ═══════════════════════════════════════════════════════════════════════════
    // Arithmetic / Data Errors (36-52)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Arithmetic overflow occurred during calculation.
    /// Cause: Result of arithmetic operation exceeds maximum value.
    Overflow = 36,

    /// Net settlement validation failed.
    /// Cause: Net settlement calculations don't match expected values.
    NetSettlementValidationFailed = 37,

    /// Escrow not found.
    /// Cause: Querying non-existent escrow record.
    EscrowNotFound = 38,

    /// Invalid escrow status for this operation.
    /// Cause: Attempting operation on escrow in wrong status.
    InvalidEscrowStatus = 39,

    /// Settlement counter overflow.
    /// Cause: Settlement counter would exceed u64::MAX.
    SettlementCounterOverflow = 40,

    /// Invalid batch size for batch operations.
    /// Cause: Provided batch size is zero or exceeds max limits.
    InvalidBatchSize = 41,

    /// Data corruption detected in stored values.
    /// Cause: Integrity checks failed on stored data.
    DataCorruption = 42,

    /// Index out of bounds.
    /// Cause: Accessing collection with invalid index.
    IndexOutOfBounds = 43,

    /// Collection is empty.
    /// Cause: Operation requires at least one element.
    EmptyCollection = 44,

    /// Key not found in map.
    /// Cause: Lookup failed for required key.
    KeyNotFound = 45,

    /// String conversion failed.
    /// Cause: Invalid or malformed string conversion.
    StringConversionFailed = 46,

    /// Invalid symbol string.
    /// Cause: Symbol is invalid or malformed.
    InvalidSymbol = 47,

    /// Arithmetic underflow occurred.
    /// Cause: Result of arithmetic operation is below minimum.
    Underflow = 48,

    /// Idempotency key exists but request payload differs.
    /// Cause: Same idempotency key used with different request parameters.
    IdempotencyConflict = 49,

    /// Proof validation failed.
    /// Cause: Signature is invalid or signer doesn't match expected oracle.
    InvalidProof = 50,

    /// Proof is required but not provided.
    /// Cause: Settlement requires proof validation but proof parameter is None.
    MissingProof = 51,

    /// Oracle address is invalid or not configured.
    /// Cause: Settlement requires proof but oracle_address is None.
    InvalidOracleAddress = 52,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test 1 (Unit): Every ContractError variant must map to a unique u32 value.
    #[test]
    fn test_error_codes_are_unique() {
        let variants: &[(ContractError, u32)] = &[
            (ContractError::AlreadyInitialized,          1),
            (ContractError::NotInitialized,              2),
            (ContractError::InvalidAmount,               3),
            (ContractError::InvalidFeeBps,               4),
            (ContractError::AgentNotRegistered,          5),
            (ContractError::RemittanceNotFound,          6),
            (ContractError::InvalidStatus,               7),
            (ContractError::InvalidStateTransition,      8),
            (ContractError::NoFeesToWithdraw,            9),
            (ContractError::InvalidAddress,              10),
            (ContractError::SettlementExpired,           11),
            (ContractError::DuplicateSettlement,         12),
            (ContractError::ContractPaused,              13),
            (ContractError::AssetNotFound,               14),
            (ContractError::UserBlacklisted,             15),
            (ContractError::InvalidReputationScore,      16),
            (ContractError::KycNotApproved,              17),
            (ContractError::SuspiciousAsset,             18),
            (ContractError::AnchorTransactionFailed,     19),
            (ContractError::Unauthorized,                20),
            (ContractError::DailySendLimitExceeded,      21),
            (ContractError::TokenAlreadyWhitelisted,     22),
            (ContractError::KycExpired,                  23),
            (ContractError::TransactionNotFound,         24),
            (ContractError::RateLimitExceeded,           25),
            (ContractError::AdminAlreadyExists,          26),
            (ContractError::AdminNotFound,               27),
            (ContractError::CannotRemoveLastAdmin,       28),
            (ContractError::TokenNotWhitelisted,         29),
            (ContractError::InvalidMigrationHash,        30),
            (ContractError::MigrationInProgress,         31),
            (ContractError::InvalidMigrationBatch,       32),
            (ContractError::CooldownActive,              33),
            (ContractError::SuspiciousActivity,          34),
            (ContractError::ActionBlocked,               35),
            (ContractError::Overflow,                    36),
            (ContractError::NetSettlementValidationFailed, 37),
            (ContractError::EscrowNotFound,              38),
            (ContractError::InvalidEscrowStatus,         39),
            (ContractError::SettlementCounterOverflow,   40),
            (ContractError::InvalidBatchSize,            41),
            (ContractError::DataCorruption,              42),
            (ContractError::IndexOutOfBounds,            43),
            (ContractError::EmptyCollection,             44),
            (ContractError::KeyNotFound,                 45),
            (ContractError::StringConversionFailed,      46),
            (ContractError::InvalidSymbol,               47),
            (ContractError::Underflow,                   48),
            (ContractError::IdempotencyConflict,         49),
            (ContractError::InvalidProof,                50),
            (ContractError::MissingProof,                51),
            (ContractError::InvalidOracleAddress,        52),
        ];

        // Assert each variant maps to its expected discriminant.
        for &(variant, expected) in variants {
            assert_eq!(
                variant as u32, expected,
                "ContractError variant discriminant mismatch: expected {}, got {}",
                expected, variant as u32
            );
        }

        // Assert all discriminants are unique (no two variants share a value).
        let codes: Vec<u32> = variants.iter().map(|&(_, c)| c).collect();
        for i in 0..codes.len() {
            for j in (i + 1)..codes.len() {
                assert_ne!(
                    codes[i], codes[j],
                    "Duplicate discriminant {} at indices {} and {}",
                    codes[i], i, j
                );
            }
        }
    }

    /// Test 2 (Integration): Verify ContractPaused == 13 and UserBlacklisted == 15.
    #[test]
    fn test_contract_paused_and_user_blacklisted_codes() {
        assert_eq!(
            ContractError::ContractPaused as u32, 13,
            "ContractPaused must be error code 13"
        );
        assert_eq!(
            ContractError::UserBlacklisted as u32, 15,
            "UserBlacklisted must be error code 15"
        );
    }
}
