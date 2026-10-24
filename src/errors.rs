//! Error types for the SwiftRemit contract.
//!
//! This module defines all possible error conditions that can occur
//! during contract execution. All errors are explicitly defined with
//! unique error codes to ensure deterministic error handling.
//!
//! The discriminant values are the on-chain error codes and MUST match
//! the table in README.md exactly. Run `node scripts/generate-error-table.js`
//! after any change to regenerate the README table.

use soroban_sdk::contracterror;

#[contracterror(export = false)]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    // ═══════════════════════════════════════════════════════════════════════════
    // Initialization Errors (1-2)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Contract has already been initialized.
    AlreadyInitialized = 1,

    /// Contract has not been initialized yet.
    NotInitialized = 2,

    // ═══════════════════════════════════════════════════════════════════════════
    // Validation Errors (3-10)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Amount must be greater than zero.
    InvalidAmount = 3,

    /// Fee must be between 0 and 10000 basis points (0-100%).
    InvalidFeeBps = 4,

    /// Agent is not registered in the system.
    AgentNotRegistered = 5,

    /// Remittance not found.
    RemittanceNotFound = 6,

    /// Invalid remittance status for this operation.
    InvalidStatus = 7,

    /// Invalid state transition attempted.
    InvalidStateTransition = 8,

    /// No fees available to withdraw.
    NoFeesToWithdraw = 9,

    /// Invalid address format or validation failed.
    InvalidAddress = 10,

    // ═══════════════════════════════════════════════════════════════════════════
    // Settlement Errors (11-12)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Settlement window has expired.
    SettlementExpired = 11,

    /// Settlement has already been executed.
    DuplicateSettlement = 12,

    // ═══════════════════════════════════════════════════════════════════════════
    // Contract State & User Errors (13-25)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Contract is paused. Settlements are temporarily disabled.
    ContractPaused = 13,

    /// Asset verification record not found.
    AssetNotFound = 14,

    /// User is blacklisted and cannot perform transactions.
    UserBlacklisted = 15,

    /// Reputation score must be between 0 and 100.
    InvalidReputationScore = 16,

    /// User KYC is not approved.
    KycNotApproved = 17,

    /// Asset has been flagged as suspicious.
    SuspiciousAsset = 18,

    /// Anchor transaction failed.
    AnchorTransactionFailed = 19,

    /// Caller is not authorized to perform admin operations.
    Unauthorized = 20,

    /// Daily send limit exceeded for this user.
    DailySendLimitExceeded = 21,

    /// Token is already whitelisted in the system.
    TokenAlreadyWhitelisted = 22,

    /// User KYC has expired.
    KycExpired = 23,

    /// Transaction record not found.
    TransactionNotFound = 24,

    /// Rate limit exceeded.
    RateLimitExceeded = 25,

    // ═══════════════════════════════════════════════════════════════════════════
    // Authorization Errors (26-29)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Admin address already exists in the system.
    AdminAlreadyExists = 26,

    /// Admin address does not exist in the system.
    AdminNotFound = 27,

    /// Cannot remove the last admin from the system.
    CannotRemoveLastAdmin = 28,

    /// Token is not whitelisted for use in the system.
    TokenNotWhitelisted = 29,

    // ═══════════════════════════════════════════════════════════════════════════
    // Migration Errors (30-32)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Migration hash verification failed.
    InvalidMigrationHash = 30,

    /// Migration already in progress or completed.
    MigrationInProgress = 31,

    /// Migration batch out of order or invalid.
    InvalidMigrationBatch = 32,

    // ═══════════════════════════════════════════════════════════════════════════
    // Rate Limiting / Abuse Errors (33-35)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Cooldown period is still active.
    CooldownActive = 33,

    /// Suspicious activity detected.
    SuspiciousActivity = 34,

    /// Action temporarily blocked due to abuse protection.
    ActionBlocked = 35,

    // ═══════════════════════════════════════════════════════════════════════════
    // Arithmetic / Data Errors (36-50)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Arithmetic overflow occurred during calculation.
    Overflow = 36,

    /// Net settlement validation failed.
    NetSettlementValidationFailed = 37,

    /// Escrow not found.
    EscrowNotFound = 38,

    /// Invalid escrow status for this operation.
    InvalidEscrowStatus = 39,

    /// Settlement counter overflow.
    SettlementCounterOverflow = 40,

    /// Invalid batch size for batch operations.
    InvalidBatchSize = 41,

    /// Data corruption detected in stored values.
    DataCorruption = 42,

    /// Index out of bounds.
    IndexOutOfBounds = 43,

    /// Collection is empty.
    EmptyCollection = 44,

    /// Key not found in map.
    KeyNotFound = 45,

    /// String conversion failed.
    StringConversionFailed = 46,

    /// Invalid or malformed symbol string.
    InvalidSymbol = 47,

    /// Arithmetic underflow occurred.
    Underflow = 48,

    /// No pending admin transfer to accept.
    NoPendingAdminTransfer = 49,

    /// Idempotency key conflict with different payload.
    IdempotencyConflict = 50,

    // ═══════════════════════════════════════════════════════════════════════════
    // Off-Chain Proof / Oracle Errors (51-53)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Off-chain proof validation failed — proof doesn't match commitment.
    ///
    /// The submitted proof does not match the expected commitment for this
    /// settlement. Proof validation uses constant-time comparison to prevent
    /// timing-based side-channel attacks (#1527).
    InvalidProof = 51,

    /// Proof is required but not provided.
    ///
    /// The settlement config mandates a proof (`require_proof = true`) but
    /// the caller did not supply one.
    MissingProof = 52,

    /// Oracle address is invalid or not configured.
    InvalidOracleAddress = 53,

    // ═══════════════════════════════════════════════════════════════════════════
    // Circuit Breaker / Pause Errors (54-55)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Contract is already paused.
    AlreadyPaused = 54,

    /// Contract is not currently paused.
    NotPaused = 55,

    // ═══════════════════════════════════════════════════════════════════════════
    // Multi-Sig / Operation Errors (56-61)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Pending admin operation not found.
    OperationNotFound = 56,

    /// Caller has already approved this pending operation.
    AlreadyApproved = 57,

    /// Pending operation has exceeded its time-to-live.
    OperationExpired = 58,

    /// Multi-sig threshold is invalid.
    InvalidMultiSigThreshold = 59,

    /// Address is already in the admin set.
    AlreadyAdmin = 60,

    /// Removing this admin would drop the admin count below quorum.
    InsufficientAdmins = 61,

    // ═══════════════════════════════════════════════════════════════════════════
    // Governance Errors (62-68)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Quorum must be >= 1 and <= current admin count.
    InvalidQuorum = 62,

    /// Admin has already cast a vote on this proposal.
    AlreadyVoted = 63,

    /// Proposal is not in the required state for this operation.
    InvalidProposalState = 64,

    /// A fee-update proposal is already pending or approved.
    ProposalAlreadyPending = 65,

    /// Proposal timelock has not elapsed.
    TimelockActive = 66,

    /// Governance has already been initialized.
    GovernanceAlreadyInitialized = 67,

    /// Proposal with the given ID does not exist.
    ProposalNotFound = 68,

    // ═══════════════════════════════════════════════════════════════════════════
    // Agent Errors (69-70)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Agent is already registered in the system.
    AgentAlreadyRegistered = 69,

    /// Agent does not meet the minimum reputation threshold.
    BelowMinReputation = 70,

    // ═══════════════════════════════════════════════════════════════════════════
    // Dispute Errors (71-72)
    // ═══════════════════════════════════════════════════════════════════════════

    /// This operation requires the remittance to be in a Disputed state.
    NotDisputed = 71,

    /// The dispute window has expired.
    DisputeWindowExpired = 72,

    // ═══════════════════════════════════════════════════════════════════════════
    // Recipient Hash / Verification Errors (73-76)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Recipient hash is required but not provided.
    MissingRecipientHash = 73,

    /// Recipient hash scheme mismatch.
    RecipientHashSchemaMismatch = 74,

    /// Recipient hash does not match stored value.
    RecipientHashMismatch = 75,

    // ═══════════════════════════════════════════════════════════════════════════
    // Misc / Extended Errors (76-90)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Migration validation failed.
    MigrationValidationFailed = 76,

    /// Multi-sig quorum requirement not met.
    MultisigQuorumRequired = 77,

    /// Timelock duration is invalid.
    InvalidTimelockDuration = 78,

    /// Pause record not found.
    PauseRecordNotFound = 79,

    /// Generic "not found" error for miscellaneous lookups.
    NotFound = 80,

    /// Evidence hash for a dispute is not a valid 32-byte SHA-256 commitment.
    MalformedEvidenceHash = 83,

    /// Dispute window exceeds the maximum permitted duration.
    DisputeWindowTooLong = 84,

    /// Escrow refund rejected: lock/expiry period has not elapsed yet.
    EscrowNotYetExpired = 85,
}
