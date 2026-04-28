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

            // Settlement Errors (11-14)
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
            ContractError::ContractPaused => (
                13,
                SorobanString::from_str(env, "Contract is paused"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::RateLimitExceeded => (
                14,
                SorobanString::from_str(env, "Rate limit exceeded, please wait"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),

            // Authorization Errors (15-18)
            ContractError::Unauthorized => (
                15,
                SorobanString::from_str(env, "Unauthorized: admin access required"),
                ErrorCategory::Authorization,
                ErrorSeverity::Medium,
            ),
            ContractError::AdminAlreadyExists => (
                16,
                SorobanString::from_str(env, "Admin already exists"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::AdminNotFound => (
                17,
                SorobanString::from_str(env, "Admin not found"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::CannotRemoveLastAdmin => (
                18,
                SorobanString::from_str(env, "Cannot remove the last admin"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),

            // Token Whitelist Errors (19-20)
            ContractError::TokenNotWhitelisted => (
                19,
                SorobanString::from_str(env, "Token is not whitelisted"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::TokenAlreadyWhitelisted => (
                20,
                SorobanString::from_str(env, "Token is already whitelisted"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),

            // Migration Errors (21-23)
            ContractError::InvalidMigrationHash => (
                21,
                SorobanString::from_str(env, "Migration hash verification failed"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),
            ContractError::MigrationInProgress => (
                22,
                SorobanString::from_str(env, "Migration already in progress"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::InvalidMigrationBatch => (
                23,
                SorobanString::from_str(env, "Migration batch is invalid"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),

            // Rate Limiting Errors (24)
            ContractError::DailySendLimitExceeded => (
                24,
                SorobanString::from_str(env, "Daily send limit exceeded"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),

            // Arithmetic Errors (25-26)
            ContractError::Overflow => (
                25,
                SorobanString::from_str(env, "Arithmetic overflow occurred"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),
            ContractError::Underflow => (
                26,
                SorobanString::from_str(env, "Arithmetic underflow occurred"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),

            // Data Integrity Errors (27-30)
            ContractError::NetSettlementValidationFailed => (
                27,
                SorobanString::from_str(env, "Net settlement validation failed"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),
            ContractError::SettlementCounterOverflow => (
                28,
                SorobanString::from_str(env, "Settlement counter overflow"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),
            ContractError::InvalidBatchSize => (
                29,
                SorobanString::from_str(env, "Invalid batch size"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            ContractError::DataCorruption => (
                30,
                SorobanString::from_str(env, "Data corruption detected"),
                ErrorCategory::System,
                ErrorSeverity::High,
            ),

            // Collection Errors (31-33)
            ContractError::IndexOutOfBounds => (
                31,
                SorobanString::from_str(env, "Index out of bounds"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            ContractError::EmptyCollection => (
                32,
                SorobanString::from_str(env, "Collection is empty"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            ContractError::KeyNotFound => (
                33,
                SorobanString::from_str(env, "Key not found in map"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),

            // String/Symbol Errors (34-35)
            ContractError::StringConversionFailed => (
                34,
                SorobanString::from_str(env, "String conversion failed"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            ContractError::InvalidSymbol => (
                35,
                SorobanString::from_str(env, "Symbol is invalid or malformed"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            ContractError::EscrowNotFound => (
                36,
                SorobanString::from_str(env, "Escrow not found"),
                ErrorCategory::Resource,
                ErrorSeverity::Medium,
            ),
            ContractError::InvalidEscrowStatus => (
                37,
                SorobanString::from_str(env, "Invalid escrow status"),
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
