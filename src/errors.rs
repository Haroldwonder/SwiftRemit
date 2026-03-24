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
    // Settlement Errors (11-15)
    // ═══════════════════════════════════════════════════════════════════════════
    
    /// Settlement window has expired.
    /// Cause: Attempting to settle remittance after expiry timestamp.
    SettlementExpired = 11,
    
    /// Settlement has already been executed.
    /// Cause: Attempting to settle the same remittance twice (duplicate prevention).
    DuplicateSettlement = 12,
    
    /// Asset verification record not found
    AssetNotFound = 13,
    
    /// Reputation score must be between 0 and 100
    InvalidReputationScore = 14,
    
    /// Asset has been flagged as suspicious
    SuspiciousAsset = 15,
    
    /// Contract is paused. Settlements are temporarily disabled.
    /// Cause: Attempting confirm_payout() while contract is in paused state.
    ContractPaused = 16,
    
    /// User is blacklisted and cannot perform transactions.
    /// Cause: User address is on the blacklist.
    UserBlacklisted = 17,
    
    /// User KYC is not approved.
    /// Cause: User has not completed KYC verification.
    KycNotApproved = 18,
    
    /// User KYC has expired.
    /// Cause: User's KYC verification has expired and needs renewal.
    KycExpired = 19,
    
    /// Transaction record not found.
    /// Cause: Querying non-existent transaction record.
    TransactionNotFound = 20,
    
    /// Anchor transaction failed.
    /// Cause: Anchor withdrawal/deposit operation failed.
    AnchorTransactionFailed = 21,
    
    RateLimitExceeded = 22,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // Authorization Errors (18-21)
    // ═══════════════════════════════════════════════════════════════════════════
    
    /// Caller is not authorized to perform admin operations.
    /// Cause: Non-admin attempting to perform admin-only operations.
    Unauthorized = 23,
    
    /// Admin address already exists in the system.
    /// Cause: Attempting to add an admin that is already registered.
    AdminAlreadyExists = 24,
    
    /// Admin address does not exist in the system.
    /// Cause: Attempting to remove an admin that is not registered.
    AdminNotFound = 25,
    
    /// Cannot remove the last admin from the system.
    /// Cause: Attempting to remove the only remaining admin.
    CannotRemoveLastAdmin = 26,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // Token Whitelist Errors (22-23)
    // ═══════════════════════════════════════════════════════════════════════════
    
    /// Token is not whitelisted for use in the system.
    /// Cause: Attempting to initialize contract with non-whitelisted token.
    TokenNotWhitelisted = 27,
    
    /// Token is already whitelisted in the system.
    /// Cause: Attempting to add a token that is already whitelisted.
    TokenAlreadyWhitelisted = 28,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // Migration Errors (24-26)
    // ═══════════════════════════════════════════════════════════════════════════
    
    /// Migration hash verification failed.
    /// Cause: Snapshot hash doesn't match computed hash (data tampering or corruption).
    InvalidMigrationHash = 29,
    
    /// Migration already in progress or completed.
    /// Cause: Attempting to start migration when one is already active.
    MigrationInProgress = 30,
    
    /// Migration batch out of order or invalid.
    /// Cause: Importing batches in wrong order or invalid batch number.
    InvalidMigrationBatch = 31,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // Rate Limiting Errors (27)
    // ═══════════════════════════════════════════════════════════════════════════
    
    /// Daily send limit exceeded for this user.
    /// Cause: User's total transfers in the last 24 hours exceed the configured limit.
    DailySendLimitExceeded = 32,
    
    /// Cooldown period is still active.
    /// Cause: Attempting action before cooldown period has elapsed.
    CooldownActive = 33,
    
    /// Suspicious activity detected.
    /// Cause: Pattern matching known abuse behaviors (rapid retries, unusual patterns).
    SuspiciousActivity = 34,
    
    /// Action temporarily blocked due to abuse protection.
    /// Cause: Multiple violations or severe abuse detected.
    ActionBlocked = 35,
    
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
}
