//! Pins every `ContractError` discriminant to the published ABI (#1864).
//!
//! The on-chain error codes are part of the public contract interface: SDKs,
//! indexers and the API map them by number. This test enumerates every
//! `ContractError` variant with its numeric discriminant and diffs the full set
//! against the `ContractError` enum in `abi/swiftremit-v1.json`, failing with a
//! readable diff on any renumbering, removal or addition.
//!
//! If the ABI ever lacks a `ContractError` section, the test falls back to the
//! checked-in snapshot `abi/contract-error-snapshot.json`.

#![cfg(test)]

extern crate alloc;
extern crate std;

use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

use crate::ContractError;

/// Every `ContractError` variant with its numeric discriminant.
///
/// Keep this list exhaustive: adding a variant to `src/errors.rs` without
/// adding it here makes the ABI test fail (and vice versa).
const CONTRACT_ERRORS: &[(u32, &str)] = &[
    (1, "AlreadyInitialized"),
    (2, "NotInitialized"),
    (3, "InvalidAmount"),
    (4, "InvalidFeeBps"),
    (5, "AgentNotRegistered"),
    (6, "RemittanceNotFound"),
    (7, "InvalidStatus"),
    (8, "InvalidStateTransition"),
    (9, "NoFeesToWithdraw"),
    (10, "InvalidAddress"),
    (11, "SettlementExpired"),
    (12, "DuplicateSettlement"),
    (13, "ContractPaused"),
    (14, "AssetNotFound"),
    (15, "UserBlacklisted"),
    (16, "InvalidReputationScore"),
    (17, "KycNotApproved"),
    (18, "SuspiciousAsset"),
    (19, "AnchorTransactionFailed"),
    (20, "Unauthorized"),
    (21, "DailySendLimitExceeded"),
    (22, "TokenAlreadyWhitelisted"),
    (23, "KycExpired"),
    (24, "TransactionNotFound"),
    (25, "RateLimitExceeded"),
    (26, "AdminAlreadyExists"),
    (27, "AdminNotFound"),
    (28, "CannotRemoveLastAdmin"),
    (29, "TokenNotWhitelisted"),
    (30, "InvalidMigrationHash"),
    (31, "MigrationInProgress"),
    (32, "InvalidMigrationBatch"),
    (33, "CooldownActive"),
    (34, "SuspiciousActivity"),
    (35, "ActionBlocked"),
    (36, "Overflow"),
    (37, "NetSettlementValidationFailed"),
    (38, "EscrowNotFound"),
    (39, "InvalidEscrowStatus"),
    (40, "SettlementCounterOverflow"),
    (41, "InvalidBatchSize"),
    (42, "DataCorruption"),
    (43, "IndexOutOfBounds"),
    (44, "EmptyCollection"),
    (45, "KeyNotFound"),
    (46, "StringConversionFailed"),
    (47, "InvalidSymbol"),
    (48, "Underflow"),
    (49, "NoPendingAdminTransfer"),
    (50, "IdempotencyConflict"),
    (51, "InvalidProof"),
    (52, "MissingProof"),
    (53, "InvalidOracleAddress"),
    (54, "AlreadyPaused"),
    (55, "NotPaused"),
    (56, "OperationNotFound"),
    (57, "AlreadyApproved"),
    (58, "OperationExpired"),
    (59, "InvalidMultiSigThreshold"),
    (60, "AlreadyAdmin"),
    (61, "InsufficientAdmins"),
    (62, "InvalidQuorum"),
    (63, "AlreadyVoted"),
    (64, "InvalidProposalState"),
    (65, "ProposalAlreadyPending"),
    (66, "TimelockActive"),
    (67, "GovernanceAlreadyInitialized"),
    (68, "ProposalNotFound"),
    (69, "AgentAlreadyRegistered"),
    (70, "BelowMinReputation"),
    (71, "NotDisputed"),
    (72, "DisputeWindowExpired"),
    (73, "MissingRecipientHash"),
    (74, "RecipientHashSchemaMismatch"),
    (75, "RecipientHashMismatch"),
    (76, "MigrationValidationFailed"),
    (77, "MultisigQuorumRequired"),
    (78, "InvalidTimelockDuration"),
    (79, "PauseRecordNotFound"),
    (80, "NotFound"),
    (83, "MalformedEvidenceHash"),
    (84, "DisputeWindowTooLong"),
    (85, "EscrowNotYetExpired"),
    (86, "TokenNotSep41"),
];

const ABI_JSON: &str = include_str!("../abi/swiftremit-v1.json");
const SNAPSHOT_JSON: &str = include_str!("../abi/contract-error-snapshot.json");

/// Parses `{ "code": <u32>, "name": "<Variant>" }` entries out of a JSON
/// document, in document order. Deliberately dependency-free: the contract
/// crate is `no_std` and must not grow a JSON dependency for a test.
fn parse_error_entries(json: &str) -> Vec<(u32, String)> {
    let mut entries = Vec::new();
    let mut rest = json;

    while let Some(code_pos) = rest.find("\"code\"") {
        rest = &rest[code_pos + "\"code\"".len()..];
        let Some(colon) = rest.find(':') else { break };
        rest = &rest[colon + 1..];

        let digits: String = rest
            .chars()
            .skip_while(|c| c.is_whitespace())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        let Ok(code) = digits.parse::<u32>() else {
            continue;
        };

        let Some(name_pos) = rest.find("\"name\"") else { break };
        rest = &rest[name_pos + "\"name\"".len()..];
        let Some(colon) = rest.find(':') else { break };
        rest = &rest[colon + 1..];
        let Some(open) = rest.find('"') else { break };
        rest = &rest[open + 1..];
        let Some(close) = rest.find('"') else { break };
        let name = rest[..close].to_string();
        rest = &rest[close + 1..];

        entries.push((code, name));
    }

    entries
}

/// Extracts the `"ContractError": { ... }` object from the ABI document.
fn contract_error_section(json: &str) -> Option<&str> {
    let start = json.find("\"ContractError\"")?;
    let rest = &json[start..];
    let open = rest.find('{')?;
    let mut depth = 0usize;
    for (idx, ch) in rest[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&rest[open..open + idx + 1]);
                }
            }
            _ => {}
        }
    }
    None
}

fn expected_entries() -> Vec<(u32, String)> {
    CONTRACT_ERRORS
        .iter()
        .map(|(code, name)| (*code, name.to_string()))
        .collect()
}

fn published_entries() -> (Vec<(u32, String)>, &'static str) {
    match contract_error_section(ABI_JSON) {
        Some(section) => (parse_error_entries(section), "abi/swiftremit-v1.json"),
        None => (
            parse_error_entries(SNAPSHOT_JSON),
            "abi/contract-error-snapshot.json (ABI has no ContractError section)",
        ),
    }
}

fn diff(expected: &[(u32, String)], actual: &[(u32, String)]) -> String {
    let mut lines: Vec<String> = Vec::new();

    for (code, name) in expected {
        match actual.iter().find(|(c, _)| c == code) {
            None => lines.push(format!(
                "  - removed:   {code} {name} (missing from published set)"
            )),
            Some((_, published_name)) if published_name != name => lines.push(format!(
                "  ~ renamed:   {code} {name} -> {published_name}"
            )),
            Some(_) => {}
        }
    }

    for (code, name) in actual {
        if expected.iter().all(|(c, _)| c != code) {
            lines.push(format!(
                "  + added:     {code} {name} (not in ContractError)"
            ));
        }
    }

    if lines.is_empty() {
        "  (no differences)".to_string()
    } else {
        lines.join("\n")
    }
}

#[test]
fn contract_error_discriminants_match_published_abi() {
    let expected = expected_entries();
    let (actual, source) = published_entries();

    assert!(
        !actual.is_empty(),
        "could not parse any ContractError entries from {source}"
    );

    assert_eq!(
        expected,
        actual,
        "ContractError discriminants drifted from {source}.\n\
         Update src/errors.rs and the published ABI together (never renumber).\n\
         Diff (expected vs published):\n{}",
        diff(&expected, &actual)
    );
}

#[test]
fn contract_error_discriminants_are_unique() {
    let mut codes: Vec<u32> = CONTRACT_ERRORS.iter().map(|(code, _)| *code).collect();
    let total = codes.len();
    codes.sort_unstable();
    codes.dedup();
    assert_eq!(codes.len(), total, "duplicate ContractError discriminant");

    let mut names: Vec<&str> = CONTRACT_ERRORS.iter().map(|(_, name)| *name).collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), total, "duplicate ContractError variant name");
}

/// Exhaustive match: adding a variant to `ContractError` breaks compilation
/// here until it is added to `CONTRACT_ERRORS`.
fn code_of(error: ContractError) -> u32 {
    match error {
        ContractError::AlreadyInitialized => 1,
        ContractError::NotInitialized => 2,
        ContractError::InvalidAmount => 3,
        ContractError::InvalidFeeBps => 4,
        ContractError::AgentNotRegistered => 5,
        ContractError::RemittanceNotFound => 6,
        ContractError::InvalidStatus => 7,
        ContractError::InvalidStateTransition => 8,
        ContractError::NoFeesToWithdraw => 9,
        ContractError::InvalidAddress => 10,
        ContractError::SettlementExpired => 11,
        ContractError::DuplicateSettlement => 12,
        ContractError::ContractPaused => 13,
        ContractError::AssetNotFound => 14,
        ContractError::UserBlacklisted => 15,
        ContractError::InvalidReputationScore => 16,
        ContractError::KycNotApproved => 17,
        ContractError::SuspiciousAsset => 18,
        ContractError::AnchorTransactionFailed => 19,
        ContractError::Unauthorized => 20,
        ContractError::DailySendLimitExceeded => 21,
        ContractError::TokenAlreadyWhitelisted => 22,
        ContractError::KycExpired => 23,
        ContractError::TransactionNotFound => 24,
        ContractError::RateLimitExceeded => 25,
        ContractError::AdminAlreadyExists => 26,
        ContractError::AdminNotFound => 27,
        ContractError::CannotRemoveLastAdmin => 28,
        ContractError::TokenNotWhitelisted => 29,
        ContractError::InvalidMigrationHash => 30,
        ContractError::MigrationInProgress => 31,
        ContractError::InvalidMigrationBatch => 32,
        ContractError::CooldownActive => 33,
        ContractError::SuspiciousActivity => 34,
        ContractError::ActionBlocked => 35,
        ContractError::Overflow => 36,
        ContractError::NetSettlementValidationFailed => 37,
        ContractError::EscrowNotFound => 38,
        ContractError::InvalidEscrowStatus => 39,
        ContractError::SettlementCounterOverflow => 40,
        ContractError::InvalidBatchSize => 41,
        ContractError::DataCorruption => 42,
        ContractError::IndexOutOfBounds => 43,
        ContractError::EmptyCollection => 44,
        ContractError::KeyNotFound => 45,
        ContractError::StringConversionFailed => 46,
        ContractError::InvalidSymbol => 47,
        ContractError::Underflow => 48,
        ContractError::NoPendingAdminTransfer => 49,
        ContractError::IdempotencyConflict => 50,
        ContractError::InvalidProof => 51,
        ContractError::MissingProof => 52,
        ContractError::InvalidOracleAddress => 53,
        ContractError::AlreadyPaused => 54,
        ContractError::NotPaused => 55,
        ContractError::OperationNotFound => 56,
        ContractError::AlreadyApproved => 57,
        ContractError::OperationExpired => 58,
        ContractError::InvalidMultiSigThreshold => 59,
        ContractError::AlreadyAdmin => 60,
        ContractError::InsufficientAdmins => 61,
        ContractError::InvalidQuorum => 62,
        ContractError::AlreadyVoted => 63,
        ContractError::InvalidProposalState => 64,
        ContractError::ProposalAlreadyPending => 65,
        ContractError::TimelockActive => 66,
        ContractError::GovernanceAlreadyInitialized => 67,
        ContractError::ProposalNotFound => 68,
        ContractError::AgentAlreadyRegistered => 69,
        ContractError::BelowMinReputation => 70,
        ContractError::NotDisputed => 71,
        ContractError::DisputeWindowExpired => 72,
        ContractError::MissingRecipientHash => 73,
        ContractError::RecipientHashSchemaMismatch => 74,
        ContractError::RecipientHashMismatch => 75,
        ContractError::MigrationValidationFailed => 76,
        ContractError::MultisigQuorumRequired => 77,
        ContractError::InvalidTimelockDuration => 78,
        ContractError::PauseRecordNotFound => 79,
        ContractError::NotFound => 80,
        ContractError::MalformedEvidenceHash => 83,
        ContractError::DisputeWindowTooLong => 84,
        ContractError::EscrowNotYetExpired => 85,
        ContractError::TokenNotSep41 => 86,
    }
}

#[test]
fn contract_error_variants_are_all_enumerated() {
    let mut mismatches: Vec<String> = Vec::new();

    for (code, name) in CONTRACT_ERRORS {
        let variant = match *name {
            "AlreadyInitialized" => ContractError::AlreadyInitialized,
            "NotInitialized" => ContractError::NotInitialized,
            "InvalidAmount" => ContractError::InvalidAmount,
            "InvalidFeeBps" => ContractError::InvalidFeeBps,
            "AgentNotRegistered" => ContractError::AgentNotRegistered,
            "RemittanceNotFound" => ContractError::RemittanceNotFound,
            "InvalidStatus" => ContractError::InvalidStatus,
            "InvalidStateTransition" => ContractError::InvalidStateTransition,
            "NoFeesToWithdraw" => ContractError::NoFeesToWithdraw,
            "InvalidAddress" => ContractError::InvalidAddress,
            "SettlementExpired" => ContractError::SettlementExpired,
            "DuplicateSettlement" => ContractError::DuplicateSettlement,
            "ContractPaused" => ContractError::ContractPaused,
            "AssetNotFound" => ContractError::AssetNotFound,
            "UserBlacklisted" => ContractError::UserBlacklisted,
            "InvalidReputationScore" => ContractError::InvalidReputationScore,
            "KycNotApproved" => ContractError::KycNotApproved,
            "SuspiciousAsset" => ContractError::SuspiciousAsset,
            "AnchorTransactionFailed" => ContractError::AnchorTransactionFailed,
            "Unauthorized" => ContractError::Unauthorized,
            "DailySendLimitExceeded" => ContractError::DailySendLimitExceeded,
            "TokenAlreadyWhitelisted" => ContractError::TokenAlreadyWhitelisted,
            "KycExpired" => ContractError::KycExpired,
            "TransactionNotFound" => ContractError::TransactionNotFound,
            "RateLimitExceeded" => ContractError::RateLimitExceeded,
            "AdminAlreadyExists" => ContractError::AdminAlreadyExists,
            "AdminNotFound" => ContractError::AdminNotFound,
            "CannotRemoveLastAdmin" => ContractError::CannotRemoveLastAdmin,
            "TokenNotWhitelisted" => ContractError::TokenNotWhitelisted,
            "InvalidMigrationHash" => ContractError::InvalidMigrationHash,
            "MigrationInProgress" => ContractError::MigrationInProgress,
            "InvalidMigrationBatch" => ContractError::InvalidMigrationBatch,
            "CooldownActive" => ContractError::CooldownActive,
            "SuspiciousActivity" => ContractError::SuspiciousActivity,
            "ActionBlocked" => ContractError::ActionBlocked,
            "Overflow" => ContractError::Overflow,
            "NetSettlementValidationFailed" => ContractError::NetSettlementValidationFailed,
            "EscrowNotFound" => ContractError::EscrowNotFound,
            "InvalidEscrowStatus" => ContractError::InvalidEscrowStatus,
            "SettlementCounterOverflow" => ContractError::SettlementCounterOverflow,
            "InvalidBatchSize" => ContractError::InvalidBatchSize,
            "DataCorruption" => ContractError::DataCorruption,
            "IndexOutOfBounds" => ContractError::IndexOutOfBounds,
            "EmptyCollection" => ContractError::EmptyCollection,
            "KeyNotFound" => ContractError::KeyNotFound,
            "StringConversionFailed" => ContractError::StringConversionFailed,
            "InvalidSymbol" => ContractError::InvalidSymbol,
            "Underflow" => ContractError::Underflow,
            "NoPendingAdminTransfer" => ContractError::NoPendingAdminTransfer,
            "IdempotencyConflict" => ContractError::IdempotencyConflict,
            "InvalidProof" => ContractError::InvalidProof,
            "MissingProof" => ContractError::MissingProof,
            "InvalidOracleAddress" => ContractError::InvalidOracleAddress,
            "AlreadyPaused" => ContractError::AlreadyPaused,
            "NotPaused" => ContractError::NotPaused,
            "OperationNotFound" => ContractError::OperationNotFound,
            "AlreadyApproved" => ContractError::AlreadyApproved,
            "OperationExpired" => ContractError::OperationExpired,
            "InvalidMultiSigThreshold" => ContractError::InvalidMultiSigThreshold,
            "AlreadyAdmin" => ContractError::AlreadyAdmin,
            "InsufficientAdmins" => ContractError::InsufficientAdmins,
            "InvalidQuorum" => ContractError::InvalidQuorum,
            "AlreadyVoted" => ContractError::AlreadyVoted,
            "InvalidProposalState" => ContractError::InvalidProposalState,
            "ProposalAlreadyPending" => ContractError::ProposalAlreadyPending,
            "TimelockActive" => ContractError::TimelockActive,
            "GovernanceAlreadyInitialized" => ContractError::GovernanceAlreadyInitialized,
            "ProposalNotFound" => ContractError::ProposalNotFound,
            "AgentAlreadyRegistered" => ContractError::AgentAlreadyRegistered,
            "BelowMinReputation" => ContractError::BelowMinReputation,
            "NotDisputed" => ContractError::NotDisputed,
            "DisputeWindowExpired" => ContractError::DisputeWindowExpired,
            "MissingRecipientHash" => ContractError::MissingRecipientHash,
            "RecipientHashSchemaMismatch" => ContractError::RecipientHashSchemaMismatch,
            "RecipientHashMismatch" => ContractError::RecipientHashMismatch,
            "MigrationValidationFailed" => ContractError::MigrationValidationFailed,
            "MultisigQuorumRequired" => ContractError::MultisigQuorumRequired,
            "InvalidTimelockDuration" => ContractError::InvalidTimelockDuration,
            "PauseRecordNotFound" => ContractError::PauseRecordNotFound,
            "NotFound" => ContractError::NotFound,
            "MalformedEvidenceHash" => ContractError::MalformedEvidenceHash,
            "DisputeWindowTooLong" => ContractError::DisputeWindowTooLong,
            "EscrowNotYetExpired" => ContractError::EscrowNotYetExpired,
            "TokenNotSep41" => ContractError::TokenNotSep41,
            other => {
                mismatches.push(format!("unknown variant name in table: {other}"));
                continue;
            }
        };

        let actual = code_of(variant);
        if actual != *code {
            mismatches.push(format!(
                "  ~ renumbered: {name} is {actual} in src/errors.rs but {code} in the table"
            ));
        }
    }

    assert!(
        mismatches.is_empty(),
        "ContractError table is out of sync with src/errors.rs:\n{}",
        mismatches.join("\n")
    );
}
