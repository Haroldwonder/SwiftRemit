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

/// Error severity levels for logging and monitoring
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
            // Initialization Errors
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
            
            // Validation Errors
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
            ContractError::InvalidAddress => (
                10,
                SorobanString::from_str(env, "Invalid address format"),
                ErrorCategory::Validation,
                ErrorSeverity::Low,
            ),
            
            // Resource Errors
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
            ContractError::AdminNotFound => (
                16,
                SorobanString::from_str(env, "Admin not found"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::AdminAlreadyExists => (
                15,
                SorobanString::from_str(env, "Admin already exists"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::TokenNotWhitelisted => (
                18,
                SorobanString::from_str(env, "Token is not whitelisted"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            ContractError::TokenAlreadyWhitelisted => (
                19,
                SorobanString::from_str(env, "Token is already whitelisted"),
                ErrorCategory::Resource,
                ErrorSeverity::Low,
            ),
            
            // State Errors
            ContractError::InvalidStatus => (
                7,
                SorobanString::from_str(env, "Invalid remittance status for this operation"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
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
            ContractError::NoFeesToWithdraw => (
                9,
                SorobanString::from_str(env, "No fees available to withdraw"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            ContractError::CannotRemoveLastAdmin => (
                17,
                SorobanString::from_str(env, "Cannot remove the last admin"),
                ErrorCategory::State,
                ErrorSeverity::Low,
            ),
            
            // Authorization Errors
            ContractError::Unauthorized => (
                14,
                SorobanString::from_str(env, "Unauthorized: admin access required"),
                ErrorCategory::Authorization,
                ErrorSeverity::Medium,
            ),
            
            // System Errors
            ContractError::Overflow => (
                8,
                SorobanString::from_str(env, "Arithmetic overflow occurred"),
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
        #[cfg(any(test, feature = "testutils"))]
        {
            use crate::debug::log_error as debug_log;
            let severity_str = match severity {
                ErrorSeverity::Low => "LOW",
                ErrorSeverity::Medium => "MEDIUM",
                ErrorSeverity::High => "HIGH",
            };
            debug_log(env, &format!("[{}] Error: {:?}", severity_str, error));
        }
        
        // In production, errors are not logged to prevent information leakage
        #[cfg(not(any(test, feature = "testutils")))]
        {
            let _ = (env, error, severity); // Suppress unused variable warnings
        }
    }
    
    /// Get error category for an error
    pub fn get_error_category(error: ContractError) -> ErrorCategory {
        match error {
            ContractError::InvalidAmount
            | ContractError::InvalidFeeBps
            | ContractError::InvalidAddress => ErrorCategory::Validation,
            
            ContractError::Unauthorized => ErrorCategory::Authorization,
            
            ContractError::AlreadyInitialized
            | ContractError::NotInitialized
            | ContractError::InvalidStatus
            | ContractError::SettlementExpired
            | ContractError::DuplicateSettlement
            | ContractError::ContractPaused
            | ContractError::NoFeesToWithdraw
            | ContractError::CannotRemoveLastAdmin => ErrorCategory::State,
            
            ContractError::AgentNotRegistered
            | ContractError::RemittanceNotFound
            | ContractError::AdminNotFound
            | ContractError::AdminAlreadyExists
            | ContractError::TokenNotWhitelisted
            | ContractError::TokenAlreadyWhitelisted => ErrorCategory::Resource,
            
            ContractError::Overflow => ErrorCategory::System,
        }
    }
    
    /// Get error severity for an error
    pub fn get_error_severity(error: ContractError) -> ErrorSeverity {
        match error {
            // Low severity - expected user errors
            ContractError::InvalidAmount
            | ContractError::InvalidFeeBps
            | ContractError::InvalidAddress
            | ContractError::AgentNotRegistered
            | ContractError::RemittanceNotFound
            | ContractError::InvalidStatus
            | ContractError::SettlementExpired
            | ContractError::ContractPaused
            | ContractError::NoFeesToWithdraw
            | ContractError::AdminNotFound
            | ContractError::AdminAlreadyExists
            | ContractError::CannotRemoveLastAdmin
            | ContractError::TokenNotWhitelisted
            | ContractError::TokenAlreadyWhitelisted
            | ContractError::AlreadyInitialized => ErrorSeverity::Low,
            
            // Medium severity - unexpected but recoverable
            ContractError::NotInitialized
            | ContractError::DuplicateSettlement
            | ContractError::Unauthorized => ErrorSeverity::Medium,
            
            // High severity - critical system errors
            ContractError::Overflow => ErrorSeverity::High,
        }
    }
    
    /// Check if error should be retried
    pub fn is_retryable(error: ContractError) -> bool {
        match error {
            // Transient errors that might succeed on retry
            ContractError::ContractPaused => true,
            
            // Permanent errors that won't succeed on retry
            ContractError::AlreadyInitialized
            | ContractError::NotInitialized
            | ContractError::InvalidAmount
            | ContractError::InvalidFeeBps
            | ContractError::AgentNotRegistered
            | ContractError::RemittanceNotFound
            | ContractError::InvalidStatus
            | ContractError::Overflow
            | ContractError::NoFeesToWithdraw
            | ContractError::InvalidAddress
            | ContractError::SettlementExpired
            | ContractError::DuplicateSettlement
            | ContractError::Unauthorized
            | ContractError::AdminAlreadyExists
            | ContractError::AdminNotFound
            | ContractError::CannotRemoveLastAdmin
            | ContractError::TokenNotWhitelisted
            | ContractError::TokenAlreadyWhitelisted => false,
        }
    }
    
    /// Get user-friendly error message
    pub fn get_user_message(env: &Env, error: ContractError) -> SorobanString {
        let (_, message, _, _) = Self::map_error(env, error);
        message
    }
    
    /// Get error code
    pub fn get_error_code(error: ContractError) -> u32 {
        error as u32
    }
}

/// Helper macro for consistent error handling in contract functions
/// 
/// Usage:
/// ```
/// handle_contract_error!(env, operation_result)
/// ```
#[macro_export]
macro_rules! handle_contract_error {
    ($env:expr, $result:expr) => {
        match $result {
            Ok(value) => Ok(value),
            Err(error) => {
                let _response = $crate::error_handler::ErrorHandler::handle_error($env, error);
                Err(error)
            }
        }
    };
}

/// Result type alias for contract operations
pub type ContractResult<T> = Result<T, ContractError>;

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_error_handler_maps_validation_errors() {
        let env = Env::default();
        
        let response = ErrorHandler::handle_error(&env, ContractError::InvalidAmount);
        assert_eq!(response.code, 3);
        assert_eq!(response.category, ErrorCategory::Validation);
        assert_eq!(response.severity, ErrorSeverity::Low);
    }

    #[test]
    fn test_error_handler_maps_authorization_errors() {
        let env = Env::default();
        
        let response = ErrorHandler::handle_error(&env, ContractError::Unauthorized);
        assert_eq!(response.code, 14);
        assert_eq!(response.category, ErrorCategory::Authorization);
        assert_eq!(response.severity, ErrorSeverity::Medium);
    }

    #[test]
    fn test_error_handler_maps_state_errors() {
        let env = Env::default();
        
        let response = ErrorHandler::handle_error(&env, ContractError::ContractPaused);
        assert_eq!(response.code, 13);
        assert_eq!(response.category, ErrorCategory::State);
        assert_eq!(response.severity, ErrorSeverity::Low);
    }

    #[test]
    fn test_error_handler_maps_resource_errors() {
        let env = Env::default();
        
        let response = ErrorHandler::handle_error(&env, ContractError::RemittanceNotFound);
        assert_eq!(response.code, 6);
        assert_eq!(response.category, ErrorCategory::Resource);
        assert_eq!(response.severity, ErrorSeverity::Low);
    }

    #[test]
    fn test_error_handler_maps_system_errors() {
        let env = Env::default();
        
        let response = ErrorHandler::handle_error(&env, ContractError::Overflow);
        assert_eq!(response.code, 8);
        assert_eq!(response.category, ErrorCategory::System);
        assert_eq!(response.severity, ErrorSeverity::High);
    }

    #[test]
    fn test_get_error_category() {
        assert_eq!(ErrorHandler::get_error_category(ContractError::InvalidAmount), ErrorCategory::Validation);
        assert_eq!(ErrorHandler::get_error_category(ContractError::Unauthorized), ErrorCategory::Authorization);
        assert_eq!(ErrorHandler::get_error_category(ContractError::ContractPaused), ErrorCategory::State);
        assert_eq!(ErrorHandler::get_error_category(ContractError::RemittanceNotFound), ErrorCategory::Resource);
        assert_eq!(ErrorHandler::get_error_category(ContractError::Overflow), ErrorCategory::System);
    }

    #[test]
    fn test_get_error_severity() {
        assert_eq!(ErrorHandler::get_error_severity(ContractError::InvalidAmount), ErrorSeverity::Low);
        assert_eq!(ErrorHandler::get_error_severity(ContractError::Unauthorized), ErrorSeverity::Medium);
        assert_eq!(ErrorHandler::get_error_severity(ContractError::Overflow), ErrorSeverity::High);
    }

    #[test]
    fn test_is_retryable() {
        assert!(ErrorHandler::is_retryable(ContractError::ContractPaused));
        assert!(!ErrorHandler::is_retryable(ContractError::InvalidAmount));
        assert!(!ErrorHandler::is_retryable(ContractError::RemittanceNotFound));
        assert!(!ErrorHandler::is_retryable(ContractError::Overflow));
    }

    #[test]
    fn test_get_user_message() {
        let env = Env::default();
        
        let message = ErrorHandler::get_user_message(&env, ContractError::InvalidAmount);
        assert_eq!(message, SorobanString::from_str(&env, "Amount must be greater than zero"));
    }

    #[test]
    fn test_get_error_code() {
        assert_eq!(ErrorHandler::get_error_code(ContractError::InvalidAmount), 3);
        assert_eq!(ErrorHandler::get_error_code(ContractError::Unauthorized), 14);
        assert_eq!(ErrorHandler::get_error_code(ContractError::Overflow), 8);
    }

    #[test]
    fn test_all_errors_have_unique_codes() {
        let env = Env::default();
        let errors = vec![
            ContractError::AlreadyInitialized,
            ContractError::NotInitialized,
            ContractError::InvalidAmount,
            ContractError::InvalidFeeBps,
            ContractError::AgentNotRegistered,
            ContractError::RemittanceNotFound,
            ContractError::InvalidStatus,
            ContractError::Overflow,
            ContractError::NoFeesToWithdraw,
            ContractError::InvalidAddress,
            ContractError::SettlementExpired,
            ContractError::DuplicateSettlement,
            ContractError::ContractPaused,
            ContractError::Unauthorized,
            ContractError::AdminAlreadyExists,
            ContractError::AdminNotFound,
            ContractError::CannotRemoveLastAdmin,
            ContractError::TokenNotWhitelisted,
            ContractError::TokenAlreadyWhitelisted,
        ];

        let mut codes = std::collections::HashSet::new();
        for error in errors {
            let response = ErrorHandler::handle_error(&env, error);
            assert!(codes.insert(response.code), "Duplicate error code: {}", response.code);
        }
    }

    #[test]
    fn test_error_messages_are_user_friendly() {
        let env = Env::default();
        
        // Messages should not contain technical jargon or stack traces
        let response = ErrorHandler::handle_error(&env, ContractError::InvalidAmount);
        let message_str = response.message.to_string();
        assert!(!message_str.contains("panic"));
        assert!(!message_str.contains("stack"));
        assert!(!message_str.contains("trace"));
    }
}
