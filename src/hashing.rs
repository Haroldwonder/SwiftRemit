//! Deterministic Hashing Standard for SwiftRemit
//!
//! This module defines the canonical method for generating settlement IDs
//! so external systems (banks, anchors, APIs) can reproduce identical hashes
//! from the same inputs.
//!
//! ## Hash Input Ordering (canonical)
//!
//! Fields are serialized in this exact order, always:
//!
//! 1. `remittance_id`  — u64,  big-endian 8 bytes
//! 2. `sender`         — Address, XDR-encoded bytes
//! 3. `agent`          — Address, XDR-encoded bytes
//! 4. `amount`         — i128, big-endian 16 bytes
//! 5. `fee`            — i128, big-endian 16 bytes
//! 6. `expiry`         — u64,  big-endian 8 bytes (0x0000000000000000 if None)
//!
//! Note: `status` is intentionally excluded — it changes over the remittance
//! lifecycle and must not affect the settlement ID.
//!
//! ## Serialization Rules
//!
//! - All integers are big-endian (network byte order)
//! - Addresses are XDR-encoded using Stellar's canonical encoding
//! - Optional fields use 8 zero bytes when None
//! - No separators between fields — fixed-width encoding eliminates ambiguity
//! - Hash algorithm: SHA-256 via Soroban env.crypto().sha256()
//!
//! ## External System Integration
//!
//! External systems can reproduce settlement IDs by:
//! 1. Collecting the same input parameters
//! 2. Serializing in the exact order specified above
//! 3. Computing SHA-256 hash of the serialized bytes
//! 4. Using the resulting 32-byte hash as the settlement ID

use soroban_sdk::{Address, Bytes, BytesN, Env};

/// Canonical field ordering version for settlement ID hashing.
///
/// This version must be incremented whenever the hash schema changes in a way
/// that would produce different output for the same logical inputs. Examples of
/// changes that require a bump:
///
/// - Adding, removing, or reordering fields in [`compute_settlement_id`]
/// - Changing the encoding of an existing field (e.g. little-endian → big-endian)
/// - Changing how `None` optional values are serialized
/// - Switching the hash algorithm from SHA-256 to something else
///
/// Changes that do NOT require a bump (output is identical):
///
/// - Refactoring internal helpers without altering byte output
/// - Adding new contract functions unrelated to settlement hashing
///
/// # Version History
///
/// | Version | Description                                      |
/// |---------|--------------------------------------------------|
/// | 1       | Initial schema: remittance_id, sender, agent,    |
/// |         | amount, fee, expiry (all big-endian / XDR)       |
///
/// # Handling a Version Mismatch
///
/// External systems (banks, anchors, off-chain indexers) **must** store the
/// `HASH_SCHEMA_VERSION` value alongside every settlement ID they persist.
/// When the on-chain version differs from the stored version:
///
/// 1. Do **not** treat the stored ID as valid for the new schema.
/// 2. Re-derive the settlement ID using the new schema by calling
///    `compute_settlement_hash(env, remittance_id)` on-chain, or by
///    following the updated field ordering documented in this module.
/// 3. Replace the stored ID with the newly derived value.
/// 4. Update the stored schema version to the current value.
///
/// See [`MIGRATION.md § Hash Schema Upgrades`] for the full migration checklist.
pub const HASH_SCHEMA_VERSION: u32 = 1;

/// Generate a deterministic settlement ID from remittance fields.
///
/// This is the single canonical implementation. External systems must
/// follow the same field ordering and encoding to produce identical output.
///
/// # Arguments
/// * `env`            - Soroban environment
/// * `remittance_id`  - Unique remittance counter ID
/// * `sender`         - Sender address
/// * `agent`          - Agent address
/// * `amount`         - Payment amount in USDC (7 decimal places)
/// * `fee`            - Fee amount in USDC (7 decimal places)
/// * `expiry`         - Optional expiry timestamp (Unix seconds), None → 0
///
/// # Returns
/// SHA-256 hash as BytesN<32> — usable as a settlement ID
pub fn compute_settlement_id(
    env: &Env,
    remittance_id: u64,
    sender: &Address,
    agent: &Address,
    amount: i128,
    fee: i128,
    expiry: Option<u64>,
) -> BytesN<32> {
    let mut buf = Bytes::new(env);

    // Field 1: remittance_id — u64 big-endian (8 bytes)
    buf.extend_from_array(&remittance_id.to_be_bytes());

    // Field 2: sender address bytes
    let sender_bytes = address_to_bytes(env, sender);
    buf.append(&sender_bytes);

    // Field 3: agent address bytes
    let agent_bytes = address_to_bytes(env, agent);
    buf.append(&agent_bytes);

    // Field 4: amount — i128 big-endian (16 bytes)
    buf.extend_from_array(&amount.to_be_bytes());

    // Field 5: fee — i128 big-endian (16 bytes)
    buf.extend_from_array(&fee.to_be_bytes());

    // Field 6: expiry — u64 big-endian (8 bytes), 0 if None
    let expiry_val: u64 = expiry.unwrap_or(0);
    buf.extend_from_array(&expiry_val.to_be_bytes());

    // SHA-256 over the canonical byte sequence
    env.crypto().sha256(&buf).into()
}

/// Compute settlement ID directly from a Remittance struct.
/// Convenience wrapper around compute_settlement_id.
pub fn compute_settlement_id_from_remittance(
    env: &Env,
    remittance: &crate::Remittance,
) -> BytesN<32> {
    compute_settlement_id(
        env,
        remittance.id,
        &remittance.sender,
        &remittance.agent,
        remittance.amount,
        remittance.fee,
        remittance.expiry,
    )
}

/// Serialize an Address to its canonical byte representation.
/// Uses Soroban's XDR encoding for deterministic, cross-platform compatibility.
///
/// External systems must use Stellar XDR encoding to reproduce this serialization.
fn address_to_bytes(env: &Env, address: &Address) -> Bytes {
    use soroban_sdk::xdr::ToXdr;
    address.to_xdr(env)
}

/// Compute a deterministic hash from remittance creation request parameters.
/// Used for idempotency key validation to detect payload changes.
///
/// # Arguments
/// * `env`    - Soroban environment
/// * `sender` - Sender address
/// * `agent`  - Agent address
/// * `amount` - Payment amount in USDC
/// * `expiry` - Optional expiry timestamp
///
/// # Returns
/// SHA-256 hash as BytesN<32>
pub fn compute_request_hash(
    env: &Env,
    sender: &Address,
    agent: &Address,
    amount: i128,
    expiry: Option<u64>,
) -> BytesN<32> {
    let mut buf = Bytes::new(env);

    // Serialize request parameters in canonical order
    let sender_bytes = address_to_bytes(env, sender);
    buf.append(&sender_bytes);

    let agent_bytes = address_to_bytes(env, agent);
    buf.append(&agent_bytes);

    buf.extend_from_array(&amount.to_be_bytes());

    let expiry_val: u64 = expiry.unwrap_or(0);
    buf.extend_from_array(&expiry_val.to_be_bytes());

    env.crypto().sha256(&buf).into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_deterministic_hash_same_inputs() {
        let env = Env::default();
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let hash1 = compute_settlement_id(&env, 1, &sender, &agent, 1000, 25, Some(1234567890));
        let hash2 = compute_settlement_id(&env, 1, &sender, &agent, 1000, 25, Some(1234567890));

        assert_eq!(hash1, hash2, "Same inputs must produce identical hashes");
    }

    #[test]
    fn test_deterministic_hash_different_inputs() {
        let env = Env::default();
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let hash1 = compute_settlement_id(&env, 1, &sender, &agent, 1000, 25, Some(1234567890));
        let hash2 = compute_settlement_id(&env, 2, &sender, &agent, 1000, 25, Some(1234567890));

        assert_ne!(hash1, hash2, "Different remittance IDs must produce different hashes");
    }

    #[test]
    fn test_deterministic_hash_field_order_matters() {
        let env = Env::default();
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let hash1 = compute_settlement_id(&env, 1, &sender, &agent, 1000, 25, None);
        let hash2 = compute_settlement_id(&env, 1, &agent, &sender, 1000, 25, None);

        assert_ne!(hash1, hash2, "Field order must affect hash output");
    }

    #[test]
    fn test_deterministic_hash_expiry_none_vs_zero() {
        let env = Env::default();
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let hash_none = compute_settlement_id(&env, 1, &sender, &agent, 1000, 25, None);
        let hash_zero = compute_settlement_id(&env, 1, &sender, &agent, 1000, 25, Some(0));

        assert_eq!(hash_none, hash_zero, "None and Some(0) must produce identical hashes");
    }
}
