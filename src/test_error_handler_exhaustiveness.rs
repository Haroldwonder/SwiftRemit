//! Exhaustiveness test for error_handler.rs category/severity mapping.
//! SR-239
//!
//! Ensures that every ContractError variant is explicitly mapped to a
//! (code, message, category, severity) tuple. Errors falling through to the
//! wildcard default (999, "Unknown error", System, High) are flagged unless
//! they are on an explicit allowlist documenting intentional fallthrough.

#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{
    error_handler::{ErrorCategory, ErrorHandler, ErrorSeverity},
    ContractError,
};

#[test]
fn test_all_contract_errors_have_distinct_mappings() {
    let env = Env::default();

    let errors_to_test = vec![
        // Initialization Errors (1-2)
        ContractError::AlreadyInitialized,
        ContractError::NotInitialized,

        // Validation Errors (3-10)
        ContractError::InvalidAmount,
        ContractError::InvalidFeeBps,
        ContractError::AgentNotRegistered,
        ContractError::RemittanceNotFound,
        ContractError::InvalidStatus,
        ContractError::InvalidStateTransition,
        ContractError::NoFeesToWithdraw,
        ContractError::InvalidAddress,

        // Settlement Errors (11-12)
        ContractError::SettlementExpired,
        ContractError::DuplicateSettlement,

        // Contract State & User Errors (13-22)
        ContractError::ContractPaused,
        ContractError::AssetNotFound,
        ContractError::UserBlacklisted,
        ContractError::InvalidReputationScore,
        ContractError::KycNotApproved,
        ContractError::SuspiciousAsset,
        ContractError::AnchorTransactionFailed,
        ContractError::Unauthorized,
        ContractError::DailySendLimitExceeded,
        ContractError::TokenAlreadyWhitelisted,

        // KYC / Transaction Errors (23-25)
        ContractError::KycExpired,
        ContractError::TransactionNotFound,
        ContractError::RateLimitExceeded,

        // Authorization Errors (26-28)
        ContractError::AdminAlreadyExists,
        ContractError::AdminNotFound,
        ContractError::CannotRemoveLastAdmin,

        // Token Whitelist Errors (29)
        ContractError::TokenNotWhitelisted,

        // Migration Errors (30-32)
        ContractError::InvalidMigrationHash,
        ContractError::MigrationInProgress,
        ContractError::InvalidMigrationBatch,

        // Rate Limiting / Abuse Errors (33-35)
        ContractError::CooldownActive,
        ContractError::SuspiciousActivity,
        ContractError::ActionBlocked,

        // Arithmetic / Data Errors (36-52)
        ContractError::Overflow,
        ContractError::NetSettlementValidationFailed,
        ContractError::EscrowNotFound,
        ContractError::InvalidEscrowStatus,
        ContractError::SettlementCounterOverflow,
        ContractError::InvalidBatchSize,
        ContractError::DataCorruption,
        ContractError::IndexOutOfBounds,
        ContractError::EmptyCollection,
        ContractError::KeyNotFound,
        ContractError::StringConversionFailed,
        ContractError::InvalidSymbol,
        ContractError::Underflow,
        ContractError::NoPendingAdminTransfer,
        ContractError::IdempotencyConflict,
        ContractError::InvalidProof,
        ContractError::MissingProof,
        ContractError::InvalidOracleAddress,
        ContractError::AlreadyPaused,
        ContractError::NotPaused,

        // Multi-Sig Errors (56-59)
        ContractError::OperationNotFound,
        ContractError::AlreadyApproved,
        ContractError::OperationExpired,
        ContractError::InvalidMultiSigThreshold,

        // Governance / DAO Errors (60-70)
        ContractError::AlreadyAdmin,
        ContractError::InsufficientAdmins,
        ContractError::InvalidQuorum,
        ContractError::AlreadyVoted,
        ContractError::InvalidProposalState,
        ContractError::ProposalAlreadyPending,
        ContractError::TimelockActive,
        ContractError::GovernanceAlreadyInitialized,
        ContractError::ProposalNotFound,
        ContractError::AgentAlreadyRegistered,

        // Dispute Errors (71-83)
        ContractError::NotDisputed,
        ContractError::MalformedEvidenceHash,

        // Restored Variants (70-79)
        ContractError::NotFound,
        ContractError::MigrationValidationFailed,
        ContractError::PauseRecordNotFound,
        ContractError::DisputeWindowExpired,
        ContractError::MissingRecipientHash,
        ContractError::RecipientHashSchemaMismatch,
        ContractError::RecipientHashMismatch,
        ContractError::InvalidTimelockDuration,
        ContractError::BelowMinReputation,
    ];

    let mut unmapped_errors = Vec::new();
    let mut error_codes = std::collections::HashSet::new();

    for error in errors_to_test {
        let response = ErrorHandler::handle_error(&env, error);

        // Check for the default/wildcard mapping (999, "Unknown error")
        if response.code == 999 && response.message.to_string() == "Unknown error" {
            unmapped_errors.push(format!("{:?}", error));
        }

        // Track that each error maps to a distinct code
        if error_codes.contains(&response.code) {
            panic!(
                "Duplicate error code {}: multiple variants map to the same code",
                response.code
            );
        }
        error_codes.insert(response.code);

        // Verify each mapping has valid category and severity
        assert!(
            matches!(
                response.category,
                ErrorCategory::Validation
                    | ErrorCategory::Authorization
                    | ErrorCategory::State
                    | ErrorCategory::Resource
                    | ErrorCategory::System
            ),
            "Error {:?} has invalid category",
            error
        );

        assert!(
            matches!(
                response.severity,
                ErrorSeverity::Low | ErrorSeverity::Medium | ErrorSeverity::High
            ),
            "Error {:?} has invalid severity",
            error
        );
    }

    assert!(
        unmapped_errors.is_empty(),
        "The following errors are not explicitly mapped and fall through to the wildcard default:\n{}",
        unmapped_errors.join("\n")
    );
}

#[test]
fn test_error_categories_are_sensible() {
    let env = Env::default();

    // Validation errors should be Low severity
    let validation_errors = vec![
        ContractError::InvalidAmount,
        ContractError::InvalidFeeBps,
        ContractError::InvalidAddress,
        ContractError::InvalidEscrowStatus,
    ];

    for error in validation_errors {
        let response = ErrorHandler::handle_error(&env, error);
        assert_eq!(
            response.category,
            ErrorCategory::Validation,
            "Error {:?} should be Validation category",
            error
        );
        assert_eq!(
            response.severity,
            ErrorSeverity::Low,
            "Validation error {:?} should be Low severity",
            error
        );
    }

    // Authorization errors should be Authorization category
    let auth_errors = vec![
        ContractError::Unauthorized,
    ];

    for error in auth_errors {
        let response = ErrorHandler::handle_error(&env, error);
        assert_eq!(
            response.category,
            ErrorCategory::Authorization,
            "Error {:?} should be Authorization category",
            error
        );
    }

    // System errors should be High severity
    let system_errors = vec![
        ContractError::Overflow,
        ContractError::Underflow,
        ContractError::DataCorruption,
        ContractError::InvalidMigrationHash,
        ContractError::NetSettlementValidationFailed,
    ];

    for error in system_errors {
        let response = ErrorHandler::handle_error(&env, error);
        assert_eq!(
            response.category,
            ErrorCategory::System,
            "Error {:?} should be System category",
            error
        );
        assert_eq!(
            response.severity,
            ErrorSeverity::High,
            "System error {:?} should be High severity",
            error
        );
    }
}

#[test]
fn test_resource_errors_map_correctly() {
    let env = Env::default();

    let resource_errors = vec![
        ContractError::RemittanceNotFound,
        ContractError::AdminNotFound,
        ContractError::TokenNotWhitelisted,
        ContractError::KeyNotFound,
        ContractError::EscrowNotFound,
    ];

    for error in resource_errors {
        let response = ErrorHandler::handle_error(&env, error);
        assert_eq!(
            response.category,
            ErrorCategory::Resource,
            "Error {:?} should be Resource category",
            error
        );
    }
}

#[test]
fn test_state_errors_map_correctly() {
    let env = Env::default();

    let state_errors = vec![
        ContractError::NotInitialized,
        ContractError::InvalidStatus,
        ContractError::ContractPaused,
        ContractError::SettlementExpired,
        ContractError::InvalidStateTransition,
    ];

    for error in state_errors {
        let response = ErrorHandler::handle_error(&env, error);
        assert_eq!(
            response.category,
            ErrorCategory::State,
            "Error {:?} should be State category",
            error
        );
    }
}

#[test]
fn test_error_response_message_never_empty() {
    let env = Env::default();

    let errors_to_test = vec![
        ContractError::AlreadyInitialized,
        ContractError::Unauthorized,
        ContractError::RemittanceNotFound,
        ContractError::Overflow,
        ContractError::ContractPaused,
    ];

    for error in errors_to_test {
        let response = ErrorHandler::handle_error(&env, error);
        let msg = response.message.to_string();
        assert!(
            !msg.is_empty() && msg != "Unknown error",
            "Error {:?} has empty or generic message: {}",
            error,
            msg
        );
    }
}
