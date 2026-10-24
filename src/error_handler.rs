#![allow(dead_code)]

use soroban_sdk::{Env, String as SorobanString};
use crate::ContractError;

/// Centralized error handling module for the SwiftRemit contract.
///
/// This module provides a single global error handler that:
/// - Maps contract errors to structured error responses
/// - Provides consistent error formatting
/// - Prevents sensitive information leakage
/// - Logs errors for debugging while keeping client responses clean
///
///   Error severity levels for logging and monitoring
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ErrorSeverity {
    /// Low severity - expected errors (validation failures, user errors)
    Low,
    /// Medium severity - unexpected but recoverable errors
    Medium,
    /// High severity - critical errors that should trigger alerts
    High,
}

/// Structured error response for clients
#[derive(Clone, Debug)]
pub struct ErrorResponse {
    /// Error code (matches ContractError discriminant)
    pub code: u32,
    /// Human-readable error message (safe for clients)
    pub message: SorobanString,
    /// Error category for grouping
    pub category: ErrorCategory,
    /// Severity level
    pub severity: ErrorSeverity,
}

/// Error categories for grouping related errors
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ErrorCategory {
    /// Validation errors (invalid input)
    Validation,
    /// Authorization errors (permission denied)
    Authorization,
    /// State errors (invalid state for operation)
    State,
    /// Resource errors (not found, already exists)
    Resource,
    /// System errors (overflow, internal errors)
    System,
}

/// Global error handler - single point for error processing
pub struct ErrorHandler;

impl ErrorHandler {
    /// Handle a contract error and return structured response
    ///
    /// This is the single global error handler that all contract functions
    /// should use for consistent error handling.
    pub fn handle_error(env: &Env, error: ContractError) -> ErrorResponse {
        let (code, message, category, severity) = Self::map_error(env, error);

        // Log error for debugging (only in debug builds)
        Self::log_error(env, error, severity);

        ErrorResponse {
            code,
            message,
            category,
            severity,
        }
    }

    /// Map ContractError to structured error information
    ///
    /// This function maps known errors to proper codes and messages,
    /// preventing stack traces and sensitive information from leaking.
    fn map_error(env: &Env, error: ContractError) -> (u32, SorobanString, ErrorCategory, ErrorSeverity) {
        match error {
            // Initialization Errors (1-2)
            ContractError::AlreadyInitialized => (
                1,
                SorobanString::from_str(env, "Contract already initialized"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::NotInitialized => (
                2,
                SorobanString::from_str(env, "Contract not initialized"),
                ErrorCategory::State,
                ErrorSeverity::Medium,
            ),

            // Validation Errors (3-10)
            ContractError::InvalidAmount => (
                3,
                SorobanString::from_str(env, "Amount must be greater than zero"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            ContractError::InvalidFeeBps => (
                4,
                SorobanString::from_str(env, "Fee must be between 0 and 10000 basis points"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            ContractError::AgentNotRegistered => (
                5,
                SorobanString::from_str(env, "Agent is not registered"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::RemittanceNotFound => (
                6,
                SorobanString::from_str(env, "Remittance not found"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::InvalidStatus => (
                7,
                SorobanString::from_str(env, "Invalid remittance status for this operation"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::InvalidStateTransition => (
                8,
                SorobanString::from_str(env, "Invalid state transition attempted"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::NoFeesToWithdraw => (
                9,
                SorobanString::from_str(env, "No fees available to withdraw"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::InvalidAddress => (
                10,
                SorobanString::from_str(env, "Invalid address format"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),

            // Settlement Errors (11-12)
            ContractError::SettlementExpired => (
                11,
                SorobanString::from_str(env, "Settlement window has expired"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::DuplicateSettlement => (
                12,
                SorobanString::from_str(env, "Settlement already executed"),
                ErrorCategory::State,
                ErrorSeverity::Medium,
            ),

            // Contract State & User Errors (13-25)
            ContractError::ContractPaused => (
                13,
                SorobanString::from_str(env, "Contract is paused"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::AssetNotFound => (
                14,
                SorobanString::from_str(env, "Asset verification record not found"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::UserBlacklisted => (
                15,
                SorobanString::from_str(env, "User is blacklisted"),
                ErrorCategory::Authorization,
                ErrorSeverity::Medium,
            ),
            ContractError::InvalidReputationScore => (
                16,
                SorobanString::from_str(env, "Reputation score must be between 0 and 100"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            ContractError::KycNotApproved => (
                17,
                SorobanString::from_str(env, "User KYC is not approved"),
                ErrorCategory::Authorization,
                ErrorSeverity::Medium,
            ),
            ContractError::SuspiciousAsset => (
                18,
                SorobanString::from_str(env, "Asset has been flagged as suspicious"),
                ErrorCategory::State,
                ErrorSeverity::High,
            ),
            ContractError::AnchorTransactionFailed => (
                19,
                SorobanString::from_str(env, "Anchor transaction failed"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),
            ContractError::Unauthorized => (
                20,
                SorobanString::from_str(env, "Unauthorized: admin access required"),
                ErrorCategory::Authorization,
                ErrorSeverity::Medium,
            ),
            ContractError::DailySendLimitExceeded => (
                21,
                SorobanString::from_str(env, "Daily send limit exceeded"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::TokenAlreadyWhitelisted => (
                22,
                SorobanString::from_str(env, "Token is already whitelisted"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::KycExpired => (
                23,
                SorobanString::from_str(env, "User KYC has expired"),
                ErrorCategory::Authorization,
                ErrorSeverity::Medium,
            ),
            ContractError::TransactionNotFound => (
                24,
                SorobanString::from_str(env, "Transaction record not found"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::RateLimitExceeded => (
                25,
                SorobanString::from_str(env, "Rate limit exceeded, please wait"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),

            // Authorization Errors (26-29)
            ContractError::AdminAlreadyExists => (
                26,
                SorobanString::from_str(env, "Admin already exists"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::AdminNotFound => (
                27,
                SorobanString::from_str(env, "Admin not found"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::CannotRemoveLastAdmin => (
                28,
                SorobanString::from_str(env, "Cannot remove the last admin"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::TokenNotWhitelisted => (
                29,
                SorobanString::from_str(env, "Token is not whitelisted"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),

            // Migration Errors (30-32)
            ContractError::InvalidMigrationHash => (
                30,
                SorobanString::from_str(env, "Migration hash verification failed"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),
            ContractError::MigrationInProgress => (
                31,
                SorobanString::from_str(env, "Migration already in progress"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::InvalidMigrationBatch => (
                32,
                SorobanString::from_str(env, "Migration batch is invalid"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),

            // Rate Limiting / Abuse Errors (33-35)
            ContractError::CooldownActive => (
                33,
                SorobanString::from_str(env, "Cooldown period is still active"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::SuspiciousActivity => (
                34,
                SorobanString::from_str(env, "Suspicious activity detected"),
                ErrorCategory::State,
                ErrorSeverity::High,
            ),
            ContractError::ActionBlocked => (
                35,
                SorobanString::from_str(env, "Action temporarily blocked due to abuse protection"),
                ErrorCategory::State,
                ErrorSeverity::High,
            ),

            // Arithmetic / Data Errors (36-50)
            ContractError::Overflow => (
                36,
                SorobanString::from_str(env, "Arithmetic overflow occurred"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),
            ContractError::NetSettlementValidationFailed => (
                37,
                SorobanString::from_str(env, "Net settlement validation failed"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),
            ContractError::EscrowNotFound => (
                38,
                SorobanString::from_str(env, "Escrow not found"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::InvalidEscrowStatus => (
                39,
                SorobanString::from_str(env, "Invalid escrow status"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            ContractError::SettlementCounterOverflow => (
                40,
                SorobanString::from_str(env, "Settlement counter overflow"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),
            ContractError::InvalidBatchSize => (
                41,
                SorobanString::from_str(env, "Invalid batch size"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            ContractError::DataCorruption => (
                42,
                SorobanString::from_str(env, "Data corruption detected"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),
            ContractError::IndexOutOfBounds => (
                43,
                SorobanString::from_str(env, "Index out of bounds"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            ContractError::EmptyCollection => (
                44,
                SorobanString::from_str(env, "Collection is empty"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            ContractError::KeyNotFound => (
                45,
                SorobanString::from_str(env, "Key not found in map"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::StringConversionFailed => (
                46,
                SorobanString::from_str(env, "String conversion failed"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            ContractError::InvalidSymbol => (
                47,
                SorobanString::from_str(env, "Symbol is invalid or malformed"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),

            // ── Off-chain proof / oracle errors ──────────────────────────────
            // #1527: InvalidProof uses constant-time comparison in verification.
            // #1528: commitment binds to remittance_id preventing replay.
            ContractError::InvalidProof => (
                51,
                SorobanString::from_str(env, "Proof validation failed"),
                ErrorCategory::Validation,
                ErrorSeverity::Medium,
            ),
            ContractError::MissingProof => (
                52,
                SorobanString::from_str(env, "Proof is required but not provided"),
                ErrorCategory::Validation,
                ErrorSeverity::Medium,
            ),
            ContractError::InvalidOracleAddress => (
                53,
                SorobanString::from_str(env, "Oracle address is invalid or not configured"),
                ErrorCategory::Validation,
                ErrorSeverity::Medium,
            ),

            // ── Circuit breaker / pause ───────────────────────────────────────
            ContractError::AlreadyPaused => (
                54,
                SorobanString::from_str(env, "Contract is already paused"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::NotPaused => (
                55,
                SorobanString::from_str(env, "Contract is not currently paused"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),

            // ── Multi-sig / operation ─────────────────────────────────────────
            ContractError::OperationNotFound => (
                56,
                SorobanString::from_str(env, "Pending admin operation not found"),
                ErrorCategory::Resource,
                ErrorSeverity::Medium,
            ),
            ContractError::AlreadyApproved => (
                57,
                SorobanString::from_str(env, "Caller already approved this operation"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::OperationExpired => (
                58,
                SorobanString::from_str(env, "Pending operation has expired"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::InvalidMultiSigThreshold => (
                59,
                SorobanString::from_str(env, "Multi-sig threshold is invalid"),
                ErrorCategory::Validation,
                ErrorSeverity::Medium,
            ),

            // ── Governance ────────────────────────────────────────────────────
            ContractError::AlreadyAdmin => (
                60,
                SorobanString::from_str(env, "Address is already an admin"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::InsufficientAdmins => (
                61,
                SorobanString::from_str(env, "Removing this admin would break quorum"),
                ErrorCategory::State,
                ErrorSeverity::Medium,
            ),
            ContractError::InvalidQuorum => (
                62,
                SorobanString::from_str(env, "Quorum value is invalid"),
                ErrorCategory::Validation,
                ErrorSeverity::Medium,
            ),
            ContractError::AlreadyVoted => (
                63,
                SorobanString::from_str(env, "Admin already voted on this proposal"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::InvalidProposalState => (
                64,
                SorobanString::from_str(env, "Proposal is not in the required state"),
                ErrorCategory::State,
                ErrorSeverity::Medium,
            ),
            ContractError::ProposalAlreadyPending => (
                65,
                SorobanString::from_str(env, "A proposal is already pending"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::TimelockActive => (
                66,
                SorobanString::from_str(env, "Proposal timelock has not elapsed"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::GovernanceAlreadyInitialized => (
                67,
                SorobanString::from_str(env, "Governance has already been initialized"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::ProposalNotFound => (
                68,
                SorobanString::from_str(env, "Proposal not found"),
                ErrorCategory::Resource,
                ErrorSeverity::Medium,
            ),

            // ── Agent ─────────────────────────────────────────────────────────
            ContractError::AgentAlreadyRegistered => (
                69,
                SorobanString::from_str(env, "Agent is already registered"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::BelowMinReputation => (
                70,
                SorobanString::from_str(env, "Agent does not meet minimum reputation"),
                ErrorCategory::Authorization,
                ErrorSeverity::Medium,
            ),

            // ── Dispute ───────────────────────────────────────────────────────
            ContractError::NotDisputed => (
                71,
                SorobanString::from_str(env, "Remittance is not in Disputed state"),
                ErrorCategory::State,
                ErrorSeverity::Medium,
            ),
            ContractError::DisputeWindowExpired => (
                72,
                SorobanString::from_str(env, "Dispute window has expired"),
                ErrorCategory::State,
                ErrorSeverity::Medium,
            ),

            // ── Recipient hash ────────────────────────────────────────────────
            ContractError::MissingRecipientHash => (
                73,
                SorobanString::from_str(env, "Recipient hash is required but not provided"),
                ErrorCategory::Validation,
                ErrorSeverity::Medium,
            ),
            ContractError::RecipientHashSchemaMismatch => (
                74,
                SorobanString::from_str(env, "Recipient hash scheme mismatch"),
                ErrorCategory::Validation,
                ErrorSeverity::Medium,
            ),
            ContractError::RecipientHashMismatch => (
                75,
                SorobanString::from_str(env, "Recipient hash does not match stored value"),
                ErrorCategory::Validation,
                ErrorSeverity::Medium,
            ),

            // ── Misc / extended ───────────────────────────────────────────────
            ContractError::MigrationValidationFailed => (
                76,
                SorobanString::from_str(env, "Migration validation failed"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),
            ContractError::MultisigQuorumRequired => (
                77,
                SorobanString::from_str(env, "Multi-sig quorum requirement not met"),
                ErrorCategory::Authorization,
                ErrorSeverity::Medium,
            ),
            ContractError::InvalidTimelockDuration => (
                78,
                SorobanString::from_str(env, "Timelock duration is invalid"),
                ErrorCategory::Validation,
                ErrorSeverity::Medium,
            ),
            ContractError::PauseRecordNotFound => (
                79,
                SorobanString::from_str(env, "Pause record not found"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::NotFound => (
                80,
                SorobanString::from_str(env, "Record not found"),
                ErrorCategory::Resource,
                ErrorSeverity::Medium,
            ),
            ContractError::MalformedEvidenceHash => (
                83,
                SorobanString::from_str(env, "Evidence hash must be a 32-byte SHA-256 digest"),
                ErrorCategory::Validation,
                ErrorSeverity::Medium,
            ),
            ContractError::DisputeWindowTooLong => (
                84,
                SorobanString::from_str(env, "Dispute window exceeds the maximum permitted duration"),
                ErrorCategory::Validation,
                ErrorSeverity::Medium,
            ),
            ContractError::EscrowNotYetExpired => (
                85,
                SorobanString::from_str(env, "Escrow refund rejected: lock period has not elapsed"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),

            // ── Arithmetic / extended ─────────────────────────────────────────
            ContractError::Underflow => (
                48,
                SorobanString::from_str(env, "Arithmetic underflow"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),
            ContractError::NoPendingAdminTransfer => (
                49,
                SorobanString::from_str(env, "No pending admin transfer to accept"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::IdempotencyConflict => (
                50,
                SorobanString::from_str(env, "Idempotency key conflict with different payload"),
                ErrorCategory::Validation,
                ErrorSeverity::Medium,
            ),

            _ => (
                999,
                SorobanString::from_str(env, "Unknown error"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),
        }
    }

    /// Log error for debugging (internal use only)
    ///
    /// Logs are only available in debug builds and never exposed to clients.
    /// This prevents stack traces and sensitive information from leaking.
    fn log_error(env: &Env, error: ContractError, severity: ErrorSeverity) {
        let _ = (env, error, severity);
    }
}

/// Result type alias for contract operations
pub type ContractResult<T> = Result<T, ContractError>;
