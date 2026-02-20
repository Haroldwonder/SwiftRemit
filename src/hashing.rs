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
//! 2. `sender`         — Address, as raw bytes
//! 3. `agent`          — Address, as raw bytes  
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
//! - Optional fields use 8 zero bytes when None
//! - No separators between fields — fixed-width encoding eliminates ambiguity
//! - Hash algorithm: SHA-256 via Soroban env.crypto().sha256()

use soroban_sdk::{Address, Bytes, BytesN, Env};

/// Canonical field ordering version — increment if ordering ever changes.
/// External systems should record this alongside stored settlement IDs.
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
/// Uses Soroban's built-in address serialization via to_xdr.
fn address_to_bytes(env: &Env, address: &Address) -> Bytes {
    use soroban_sdk::xdr::ToXdr;
    address.to_xdr(env)
}
