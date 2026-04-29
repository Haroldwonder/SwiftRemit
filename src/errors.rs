//! Error types for the SwiftRemit contract.
//!
//! This module defines all possible error conditions that can occur
//! during contract execution. All errors are explicitly defined with
//! unique error codes to ensure deterministic error handling.

use soroban_sdk::contracterror;

#[contracterror(export = false)]
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

    /// No pending admin transfer to accept.
    /// Cause: accept_admin() called when no propose_admin() has been issued.
    NoPendingAdminTransfer = 49,

    /// Idempotency key conflict with different payload.
    IdempotencyConflict = 50,

    /// Proof validation failed.
    InvalidProof = 51,

    /// Proof is required but not provided.
    MissingProof = 52,

    /// Oracle address is invalid or not configured.
    InvalidOracleAddress = 53,

    /// Contract is already paused.
    AlreadyPaused = 54,

    /// Contract is not currently paused.
    NotPaused = 55,

    /// A fee update proposal is already pending.
    ProposalAlreadyPending = 56,

    /// Agent is already registered.
    AgentAlreadyRegistered = 57,

    /// Address is already an admin.
    AlreadyAdmin = 58,

    /// Not enough admins to perform this operation.
    InsufficientAdmins = 59,

    /// Governance module is already initialized.
    GovernanceAlreadyInitialized = 60,

    /// Quorum value is invalid.
    InvalidQuorum = 61,

    /// Admin has already voted on this proposal.
    AlreadyVoted = 62,

    /// Proposal state is invalid for this operation.
    InvalidProposalState = 63,

    /// Timelock duration is invalid.
    InvalidTimelockDuration = 64,

    /// Timelock is still active.
    TimelockActive = 65,

    /// Timelock has not elapsed yet.
    TimelockNotElapsed = 66,

    /// Dispute window has expired.
    DisputeWindowExpired = 67,

    /// Remittance is not in disputed state.
    NotDisputed = 68,

    /// Migration validation failed.
    MigrationValidationFailed = 69,

    /// Record not found.
    NotFound = 70,

    /// Caller is not authorized (alias for Unauthorized in upgrade context).
    NotAuthorized = 71,

    /// Invalid input provided.
    InvalidInput = 72,

    /// Pause record not found.
    PauseRecordNotFound = 73,

    /// Recipient hash is invalid.
    InvalidRecipientHash = 74,

    /// Recipient hash is missing but required.
    MissingRecipientHash = 75,

    /// Recipient hash schema version mismatch.
    RecipientHashSchemaMismatch = 76,

    /// Recipient hash does not match stored hash.
    RecipientHashMismatch = 77,

    /// Proposal not found.
    ProposalNotFound = 78,
}
