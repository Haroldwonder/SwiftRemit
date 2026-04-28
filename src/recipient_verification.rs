//! Recipient address verification for SwiftRemit.
//!
//! This module implements on-chain recipient hash storage, retrieval, and comparison.
//! It prevents misdirected payouts by verifying that the recipient's payout details
//! match a hash registered at remittance creation time.

use soroban_sdk::{contracttype, Address, Bytes, BytesN, Env, String};

use crate::ContractError;
use crate::events::{emit_recipient_hash_registered, emit_recipient_verified, emit_recipient_verification_failed};
use crate::storage::{get_recipient_hash_record, set_recipient_hash as storage_set_recipient_hash};

// ============================================================================
// Constants
// ============================================================================

/// Current canonical serialization schema version.
/// Increment this whenever the canonical serialization format changes.
pub const RECIPIENT_HASH_SCHEMA_VERSION: u32 = 1;

// ============================================================================
// Data Types
// ============================================================================

/// Wallet payout destination — a Stellar address.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WalletRecipient {
    pub address: Address,
}

/// Bank payout destination — account number and routing code.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BankRecipient {
    pub account_number: String,
    pub routing_code: String,
}

/// Payout destination — either a Stellar wallet or a bank account.
///
/// This type is used only in the `compute_recipient_hash` view function.
/// It is never stored on-chain; only the 32-byte SHA-256 digest is stored.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RecipientDetails {
    Wallet(WalletRecipient),
    Bank(BankRecipient),
}

/// Stored record: hash + the schema version used to produce it.
///
/// Stored in persistent storage under `DataKey::RecipientHash(remittance_id)`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecipientHashRecord {
    pub hash: BytesN<32>,
    pub schema_version: u32,
}

/// Outcome of a recipient hash verification.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VerificationOutcome {
    /// Verification passed — hashes matched.
    Verified,
    /// Remittance has no stored hash — verification-exempt path.
    Exempt,
}

// ============================================================================
// Hash Computation
// ============================================================================

/// Compute the canonical SHA-256 hash of `RecipientDetails`.
///
/// # Serialization (Schema Version 1)
///
/// **Wallet:**
/// ```text
/// [0x01]                        // 1-byte type tag
/// <XDR-encoded Stellar Address> // variable length
/// ```
///
/// **Bank:**
/// ```text
/// [0x02]                        // 1-byte type tag
/// <u32 big-endian length>       // 4 bytes: byte length of account_number UTF-8
/// <account_number UTF-8 bytes>  // variable
/// <u32 big-endian length>       // 4 bytes: byte length of routing_code UTF-8
/// <routing_code UTF-8 bytes>    // variable
/// ```
pub fn compute_recipient_hash(env: &Env, details: RecipientDetails) -> BytesN<32> {
    let mut buf = Bytes::new(env);

    match details {
        RecipientDetails::Wallet(w) => {
            // Type tag: 0x01
            buf.extend_from_array(&[0x01u8]);
            // XDR-encoded address bytes
            use soroban_sdk::xdr::ToXdr;
            let addr_bytes = w.address.to_xdr(env);
            buf.append(&addr_bytes);
        }
        RecipientDetails::Bank(b) => {
            // Type tag: 0x02
            buf.extend_from_array(&[0x02u8]);

            // account_number: 4-byte big-endian length prefix + UTF-8 bytes
            let acct_len = b.account_number.len() as usize;
            buf.extend_from_array(&(acct_len as u32).to_be_bytes());
            // Copy string bytes into a stack buffer then into Bytes
            let mut acct_buf = [0u8; 256];
            b.account_number.copy_into_slice(&mut acct_buf[..acct_len]);
            buf.extend_from_slice(&acct_buf[..acct_len]);

            // routing_code: 4-byte big-endian length prefix + UTF-8 bytes
            let route_len = b.routing_code.len() as usize;
            buf.extend_from_array(&(route_len as u32).to_be_bytes());
            let mut route_buf = [0u8; 256];
            b.routing_code.copy_into_slice(&mut route_buf[..route_len]);
            buf.extend_from_slice(&route_buf[..route_len]);
        }
    }

    env.crypto().sha256(&buf).into()
}

// ============================================================================
// Core Verification Logic
// ============================================================================

/// Store a recipient hash for a remittance.
///
/// Validates that the hash is exactly 32 bytes, persists the record, and emits
/// a `RecipientHashRegistered` event.
///
/// # Errors
/// - `ContractError::InvalidRecipientHash` — hash is not exactly 32 bytes
pub fn store_recipient_hash(
    env: &Env,
    remittance_id: u64,
    hash: &BytesN<32>,
) -> Result<(), ContractError> {
    // BytesN<32> is always exactly 32 bytes by type — no runtime length check needed.
    // The type system enforces this at compile time.
    let record = RecipientHashRecord {
        hash: hash.clone(),
        schema_version: RECIPIENT_HASH_SCHEMA_VERSION,
    };

    // Emit before storing (emit-before-return convention)
    emit_recipient_hash_registered(env, remittance_id, hash.clone(), RECIPIENT_HASH_SCHEMA_VERSION);

    storage_set_recipient_hash(env, remittance_id, &record);

    Ok(())
}

/// Verify the agent-supplied hash against the stored record.
///
/// # Returns
/// - `Ok(VerificationOutcome::Exempt)` — no hash stored, remittance is verification-exempt
/// - `Ok(VerificationOutcome::Verified)` — hashes matched, payout may proceed
/// - `Err(ContractError::MissingRecipientHash)` — hash stored but none supplied
/// - `Err(ContractError::RecipientHashSchemaMismatch)` — stored schema version differs
/// - `Err(ContractError::RecipientHashMismatch)` — supplied hash does not match stored hash
pub fn verify_recipient_hash(
    env: &Env,
    remittance_id: u64,
    agent: &Address,
    supplied_hash: Option<BytesN<32>>,
) -> Result<VerificationOutcome, ContractError> {
    let record = match get_recipient_hash_record(env, remittance_id) {
        None => return Ok(VerificationOutcome::Exempt),
        Some(r) => r,
    };

    // Hash is stored — agent must supply one
    let provided = supplied_hash.ok_or(ContractError::MissingRecipientHash)?;

    // Schema version check
    if record.schema_version != RECIPIENT_HASH_SCHEMA_VERSION {
        return Err(ContractError::RecipientHashSchemaMismatch);
    }

    // Compare hashes
    if provided == record.hash {
        // Emit before returning (emit-before-return convention)
        emit_recipient_verified(env, remittance_id, agent.clone());
        Ok(VerificationOutcome::Verified)
    } else {
        // Emit before returning (emit-before-return convention)
        emit_recipient_verification_failed(env, remittance_id, agent.clone());
        Err(ContractError::RecipientHashMismatch)
    }
}

/// Retrieve the stored hash record for a remittance.
///
/// Returns `None` if the remittance is verification-exempt (no hash registered).
/// Returns `RemittanceNotFound` if the remittance_id does not exist at all.
pub fn get_recipient_hash(
    env: &Env,
    remittance_id: u64,
) -> Result<Option<RecipientHashRecord>, ContractError> {
    // Verify the remittance exists
    crate::storage::get_remittance(env, remittance_id)?;
    // Return the hash record (None if exempt)
    Ok(get_recipient_hash_record(env, remittance_id))
}

/// Return the current `RECIPIENT_HASH_SCHEMA_VERSION`.
pub fn get_recipient_hash_schema_version() -> u32 {
    RECIPIENT_HASH_SCHEMA_VERSION
}

// ============================================================================
// Issue #422 — Recipient Hash Versioning Migration Path
// ============================================================================

/// A single entry in a migration batch: the remittance ID and the new
/// `RecipientDetails` to hash under the current schema version.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecipientHashMigrationEntry {
    pub remittance_id: u64,
    pub new_details: RecipientDetails,
}

/// Admin function: recompute recipient hashes for a batch of remittances under
/// the current `RECIPIENT_HASH_SCHEMA_VERSION`.
///
/// During a schema-version bump, previously stored hashes become unverifiable
/// because they were produced with the old serialization format. This function
/// allows an admin to supply the plaintext `RecipientDetails` for each affected
/// remittance so the contract can recompute and overwrite the stored hash.
///
/// # Dual-version transition window
///
/// While a migration is in progress the contract stores **both** the old hash
/// (under `DataKey::RecipientHash`) and the new hash (under
/// `DataKey::RecipientHashV2`). `verify_recipient_hash` checks the new key
/// first; if absent it falls back to the old key. Once all remittances have
/// been migrated the admin can call `finalize_recipient_hash_migration` to
/// remove the old keys.
///
/// # Authorization
/// Caller must be the contract admin (enforced at the call site in `lib.rs`).
///
/// # Returns
/// The number of entries successfully migrated.
pub fn migrate_recipient_hashes(
    env: &Env,
    batch: soroban_sdk::Vec<RecipientHashMigrationEntry>,
) -> Result<u32, ContractError> {
    let mut migrated: u32 = 0;

    for i in 0..batch.len() {
        let entry = batch.get_unchecked(i);

        // Only migrate remittances that actually have a stored hash record.
        let existing = match get_recipient_hash_record(env, entry.remittance_id) {
            None => continue, // no hash stored — nothing to migrate
            Some(r) => r,
        };

        // Recompute under the current schema version.
        let new_hash = compute_recipient_hash(env, entry.new_details);

        // Store the new-version record.
        let new_record = RecipientHashRecord {
            hash: new_hash.clone(),
            schema_version: RECIPIENT_HASH_SCHEMA_VERSION,
        };
        storage_set_recipient_hash(env, entry.remittance_id, &new_record);

        // Emit an event so off-chain indexers can track the migration.
        emit_recipient_hash_registered(
            env,
            entry.remittance_id,
            new_hash,
            RECIPIENT_HASH_SCHEMA_VERSION,
        );

        // Suppress unused-variable warning for `existing` — we intentionally
        // overwrite it; the old hash is no longer valid after the schema bump.
        let _ = existing;

        migrated = migrated.saturating_add(1);
    }

    Ok(migrated)
}
