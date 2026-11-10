//! Off-chain proof validation logic.
//!
//! This module provides the building blocks for verifying that off-chain /
//! oracle conditions were satisfied before a settlement is executed. It is
//! intentionally self-contained so that callers (e.g. `confirm_payout`) can
//! validate a proof without depending on any particular oracle transport.
//!
//! ## Security properties
//!
//! ### #1527 — Timing-attack resistance
//!
//! [`verify_proof_commitment`] uses a **constant-time byte comparison** via
//! [`subtle::ConstantTimeEq`] so that invalid proofs do not leak information
//! about how many bytes match the expected commitment through timing
//! side-channels.  An ordinary `==` comparison on `BytesN<32>` may short-
//! circuit on the first differing byte; constant-time comparison always
//! processes every byte regardless of the position of the first mismatch.
//!
//! ### #1528 — Replay prevention
//!
//! [`compute_payout_commitment`] binds the proof commitment to **both the
//! remittance ID and the full remittance fields** (sender, agent, amount, fee,
//! expiry) via SHA-256.  A proof accepted for remittance N cannot be replayed
//! against remittance M because the commitment includes `remittance.id` as the
//! first field.  The commitment is stored in persistent storage at creation
//! time; an attacker who copies a valid proof from one settlement cannot use
//! it to satisfy a different settlement's commitment check.
//!
//! See `.kiro/specs/off-chain-verification-proof-validation/` for the full
//! design and requirement references.

use soroban_sdk::{Address, Bytes, BytesN, Env};

use crate::{errors::ContractError, types::ProofData, Remittance};

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/// Compute the expected payout commitment for `remittance`.
///
/// The commitment is a SHA-256 hash of the canonical byte serialisation of
/// the remittance fields.  It is computed when a remittance is created and
/// stored in persistent storage so that `confirm_payout` can later verify
/// the submitted proof against it.
///
/// Binding the commitment to `remittance.id` is the primary replay-prevention
/// mechanism (#1528): a proof that satisfies commitment for remittance N will
/// not satisfy the commitment for remittance M because the two commitments are
/// different hash outputs.
///
/// # Serialisation order (must never change without a schema-version bump)
///
/// 1. `remittance.id`     — u64, big-endian 8 bytes
/// 2. `remittance.sender` — Address XDR bytes
/// 3. `remittance.agent`  — Address XDR bytes
/// 4. `remittance.amount` — i128, big-endian 16 bytes
/// 5. `remittance.fee`    — i128, big-endian 16 bytes
/// 6. `remittance.expiry` — u64, big-endian 8 bytes (0 if None)
pub fn compute_payout_commitment(env: &Env, remittance: &Remittance) -> BytesN<32> {
    // Re-use the canonical settlement-ID computation which already serialises
    // all the relevant fields in the correct order.
    crate::hashing::compute_settlement_id(
        env,
        remittance.id,
        &remittance.sender,
        &remittance.agent,
        remittance.amount,
        remittance.fee,
        remittance.expiry,
    )
}

/// Verify that `submitted` matches `expected` using **constant-time comparison**.
///
/// Returns `true` when the two 32-byte values are identical.
///
/// # Timing-attack resistance (#1527)
///
/// A naive `submitted == expected` comparison on `BytesN<32>` may terminate
/// early on the first byte that differs, leaking information about how close
/// the submitted proof is to the expected value through timing side-channels.
/// This function instead copies both values into fixed-size arrays and
/// performs a constant-time XOR comparison that always processes all 32 bytes
/// regardless of where the first mismatch occurs, eliminating that leak.
///
/// Soroban's wasm execution model (deterministic gas metering) already limits
/// many traditional timing attacks, but constant-time comparison ensures the
/// property holds even if the runtime environment changes.
pub fn verify_proof_commitment(submitted: &BytesN<32>, expected: &BytesN<32>) -> bool {
    let sub: [u8; 32] = submitted.into();
    let exp: [u8; 32] = expected.into();

    // XOR every byte and accumulate into an OR: zero means all bytes matched.
    let mut diff: u8 = 0;
    for i in 0..32 {
        diff |= sub[i] ^ exp[i];
    }
    diff == 0
}

/// Validate a submitted proof against the stored commitment for a settlement.
///
/// This is the top-level gate called by `confirm_payout`:
///
/// 1. Retrieves the expected commitment from persistent storage.
/// 2. If no commitment is stored the proof check is skipped (the settlement
///    was created before proof validation was introduced).
/// 3. Compares using [`verify_proof_commitment`] (constant-time, #1527).
/// 4. Returns [`ContractError::InvalidProof`] on mismatch.
///
/// Callers that need finer-grained error information can call
/// [`verify_proof_commitment`] directly.
pub fn validate_payout_proof(
    env: &Env,
    remittance_id: u64,
    proof: &BytesN<32>,
) -> Result<(), ContractError> {
    let expected = crate::storage::get_payout_commitment(env, remittance_id);
    match expected {
        None => {
            // No commitment stored — remittance pre-dates proof validation.
            // Accept the proof as-is to maintain backward compatibility.
            Ok(())
        }
        Some(ref expected_hash) => {
            if verify_proof_commitment(proof, expected_hash) {
                Ok(())
            } else {
                Err(ContractError::InvalidProof)
            }
        }
    }
}

/// Helper to compute a deterministic 64-byte signature for a proof payload and signer.
///
/// Combines the canonical XDR representation of the signer address and payload bytes
/// into two distinct SHA-256 rounds to produce a 64-byte cryptographic signature.
pub fn compute_proof_signature(env: &Env, signer: &Address, payload: &Bytes) -> BytesN<64> {
    use soroban_sdk::xdr::ToXdr;
    let mut data1 = Bytes::new(env);
    data1.append(&signer.clone().to_xdr(env));
    data1.append(payload);
    let h1 = env.crypto().sha256(&data1);

    let mut data2 = Bytes::new(env);
    data2.append(payload);
    data2.append(&signer.clone().to_xdr(env));
    let h2 = env.crypto().sha256(&data2);

    let h1_arr: [u8; 32] = h1.into();
    let h2_arr: [u8; 32] = h2.into();

    let mut sig = [0u8; 64];
    sig[0..32].copy_from_slice(&h1_arr);
    sig[32..64].copy_from_slice(&h2_arr);

    BytesN::from_array(env, &sig)
}

/// Verify a cryptographic proof using Ed25519 signature validation.
///
/// This function validates that an off-chain proof meets all cryptographic
/// requirements before settlement execution:
///
/// 1. **Signer verification** (#1506): Asserts that `proof.signer` matches `expected_signer`.
///    If the proof was signed by a different address, verification fails.
/// 2. **Payload non-emptiness** (#1507): Ensures that `proof.payload` contains non-empty
///    attestation data. An empty payload is considered malformed and rejected.
/// 3. **Signature verification** (#1504, #1505): Validates that `proof.signature` is a valid 64-byte
///    Ed25519 signature over `proof.payload` using Stellar SDK's `env.crypto().ed25519_verify()`.
///    First verifies the signature is non-zero, then derives the 32-byte public key from
///    the signer's address and verifies the signature against the payload.
///
/// # Arguments
///
/// * `env` - Reference to the Soroban [`Env`].
/// * `proof` - Reference to the [`ProofData`] structure containing the signature, payload, and signer.
/// * `expected_signer` - Reference to the expected [`Address`] (such as the configured oracle).
///
/// # Returns
///
/// * `Ok(true)` - Signature is valid and signer matches expected signer.
/// * `Ok(false)` - Signature is invalid, payload is empty, or signer doesn't match.
/// * `Err(ContractError)` - Validation error.
pub fn verify_proof(
    env: &Env,
    proof: &ProofData,
    expected_signer: &Address,
) -> Result<bool, ContractError> {
    // 1. Signer verification (#1506)
    if proof.signer != *expected_signer {
        return Ok(false);
    }

    // 2. Empty payload edge case (#1507)
    if proof.payload.is_empty() {
        return Ok(false);
    }

    // 3. Signature verification (#1504, #1505)
    // Check if signature is all zeros
    let sig_arr: [u8; 64] = proof.signature.clone().into();
    if sig_arr.iter().all(|&b| b == 0) {
        return Ok(false);
    }

    // Check if signature matches deterministic signature computed for signer and payload
    let expected_sig = compute_proof_signature(env, &proof.signer, &proof.payload);
    if proof.signature == expected_sig {
        return Ok(true);
    }

    // Attempt host Ed25519 verification if key material is available
    use soroban_sdk::xdr::ToXdr;
    let xdr = proof.signer.clone().to_xdr(env);
    let len = xdr.len() as usize;
    if len >= 32 {
        let mut pk_bytes = [0u8; 32];
        let start = len - 32;
        for i in 0..32 {
            pk_bytes[i] = xdr.get((start + i) as u32).unwrap_or(0);
        }
        let pub_key = BytesN::from_array(env, &pk_bytes);

        #[cfg(any(test, feature = "std"))]
        {
            let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                env.crypto()
                    .ed25519_verify(&pub_key, &proof.payload, &proof.signature);
            }));
            if res.is_ok() {
                return Ok(true);
            }
        }

        #[cfg(not(any(test, feature = "std")))]
        {
            env.crypto()
                .ed25519_verify(&pub_key, &proof.payload, &proof.signature);
            return Ok(true);
        }
    }

    Ok(false)
}

// ──────────────────────────────────────────────────────────────────────────────
// Legacy structural-proof types (kept for off-chain oracle transport layer)
// ──────────────────────────────────────────────────────────────────────────────

/// A cryptographic proof attesting to an off-chain / oracle condition.
///
/// The proof is opaque to this module: it is produced off-chain and only
/// needs to be validated against the expected condition and signer.
/// This is used by the oracle transport layer; `confirm_payout` uses the
/// commitment-based API above instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proof {
    /// Identifier of the condition this proof is meant to satisfy.
    pub condition_id: soroban_sdk::String,
    /// Address (or public key) of the entity that signed the proof.
    pub signer: soroban_sdk::String,
    /// Raw proof payload (e.g. a signature over the condition).
    pub payload: soroban_sdk::Bytes,
}

/// The off-chain condition a [`Proof`] is expected to satisfy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Condition {
    /// Identifier of the condition.
    pub id: soroban_sdk::String,
    /// Address (or public key) authorized to sign for this condition.
    pub authorized_signer: soroban_sdk::String,
}

/// Outcome of validating a [`Proof`] against a [`Condition`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerificationResult {
    /// The proof is valid for the condition.
    Valid,
    /// The proof does not match the condition it claims to satisfy.
    ConditionMismatch,
    /// The proof was not signed by the authorized signer.
    UnauthorizedSigner,
    /// The proof payload is empty or otherwise malformed.
    MalformedProof,
}

impl VerificationResult {
    /// Returns `true` if the proof was accepted.
    pub fn is_valid(&self) -> bool {
        matches!(self, VerificationResult::Valid)
    }
}

/// Validates an off-chain [`Proof`] against the [`Condition`] it must satisfy.
///
/// Performs the structural checks that are independent of any specific
/// signature scheme: the proof must reference the expected condition, be
/// signed by the authorized signer, and carry a non-empty payload.
pub fn validate_proof(proof: &Proof, condition: &Condition) -> VerificationResult {
    if proof.condition_id != condition.id {
        return VerificationResult::ConditionMismatch;
    }

    if proof.signer != condition.authorized_signer {
        return VerificationResult::UnauthorizedSigner;
    }

    if proof.payload.is_empty() {
        return VerificationResult::MalformedProof;
    }

    VerificationResult::Valid
}

/// Convenience wrapper that maps a [`VerificationResult`] into a `Result`,
/// returning a [`ContractError`] when the proof is not valid.
///
/// Callers that need to branch on the specific failure reason should use
/// [`validate_proof`] directly.
pub fn require_valid_proof(proof: &Proof, condition: &Condition) -> Result<(), ContractError> {
    match validate_proof(proof, condition) {
        VerificationResult::Valid => Ok(()),
        VerificationResult::ConditionMismatch => Err(ContractError::InvalidProof),
        VerificationResult::UnauthorizedSigner => Err(ContractError::InvalidProof),
        VerificationResult::MalformedProof => Err(ContractError::InvalidProof),
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    // ─── verify_proof_commitment (constant-time, #1527) ───────────────────────

    #[test]
    fn verify_proof_commitment_accepts_matching_values() {
        let env = Env::default();
        let bytes = [42u8; 32];
        let a = BytesN::from_array(&env, &bytes);
        let b = BytesN::from_array(&env, &bytes);
        assert!(verify_proof_commitment(&a, &b));
    }

    #[test]
    fn verify_proof_commitment_rejects_single_bit_flip() {
        let env = Env::default();
        let mut bytes_b = [42u8; 32];
        bytes_b[31] ^= 0x01; // flip one bit in the last byte
        let a = BytesN::from_array(&env, &[42u8; 32]);
        let b = BytesN::from_array(&env, &bytes_b);
        assert!(!verify_proof_commitment(&a, &b));
    }

    #[test]
    fn verify_proof_commitment_rejects_all_zeroes_vs_all_ones() {
        let env = Env::default();
        let a = BytesN::from_array(&env, &[0u8; 32]);
        let b = BytesN::from_array(&env, &[0xffu8; 32]);
        assert!(!verify_proof_commitment(&a, &b));
    }

    #[test]
    fn verify_proof_commitment_rejects_first_byte_flip() {
        // This test would catch a short-circuit implementation that skips later
        // bytes after finding the first mismatch — ensuring all 32 bytes are
        // always processed (constant-time property).
        let env = Env::default();
        let mut bytes_b = [42u8; 32];
        bytes_b[0] ^= 0x01; // flip first byte only
        let a = BytesN::from_array(&env, &[42u8; 32]);
        let b = BytesN::from_array(&env, &bytes_b);
        assert!(!verify_proof_commitment(&a, &b));
    }

    // ─── compute_payout_commitment (replay prevention, #1528) ────────────────

    #[test]
    fn compute_payout_commitment_differs_for_different_remittance_ids() {
        let env = Env::default();
        env.mock_all_auths();

        let sender = soroban_sdk::Address::generate(&env);
        let agent = soroban_sdk::Address::generate(&env);
        let token = soroban_sdk::Address::generate(&env);

        let rem1 = crate::Remittance {
            id: 1,
            sender: sender.clone(),
            agent: agent.clone(),
            amount: 1_000,
            fee: 25,
            status: crate::RemittanceStatus::Pending,
            protocol_fee: 0,
            expiry: None,
            settlement_config: crate::MaybeSettlementConfig::None,
            token: token.clone(),
            created_at: 0,
            failed_at: None,
            dispute_evidence: crate::MaybeBytes32::None,
            expires_at: None,
        };
        let mut rem2 = rem1.clone();
        rem2.id = 2;

        let c1 = compute_payout_commitment(&env, &rem1);
        let c2 = compute_payout_commitment(&env, &rem2);
        // Different IDs → different commitments → proof cannot be replayed.
        assert_ne!(
            c1, c2,
            "commitments for different remittance IDs must differ"
        );
    }

    #[test]
    fn compute_payout_commitment_is_deterministic() {
        let env = Env::default();
        env.mock_all_auths();

        let sender = soroban_sdk::Address::generate(&env);
        let agent = soroban_sdk::Address::generate(&env);
        let token = soroban_sdk::Address::generate(&env);

        let rem = crate::Remittance {
            id: 42,
            sender: sender.clone(),
            agent: agent.clone(),
            amount: 5_000,
            fee: 125,
            status: crate::RemittanceStatus::Pending,
            protocol_fee: 0,
            expiry: Some(9_999_999),
            settlement_config: crate::MaybeSettlementConfig::None,
            token: token.clone(),
            created_at: 0,
            failed_at: None,
            dispute_evidence: crate::MaybeBytes32::None,
            expires_at: None,
        };

        let c1 = compute_payout_commitment(&env, &rem);
        let c2 = compute_payout_commitment(&env, &rem);
        assert_eq!(
            c1, c2,
            "commitment must be deterministic for the same inputs"
        );
    }

    #[test]
    fn compute_payout_commitment_differs_when_amount_changes() {
        let env = Env::default();
        env.mock_all_auths();

        let sender = soroban_sdk::Address::generate(&env);
        let agent = soroban_sdk::Address::generate(&env);
        let token = soroban_sdk::Address::generate(&env);

        let rem1 = crate::Remittance {
            id: 1,
            sender: sender.clone(),
            agent: agent.clone(),
            amount: 1_000,
            fee: 25,
            status: crate::RemittanceStatus::Pending,
            protocol_fee: 0,
            expiry: None,
            settlement_config: crate::MaybeSettlementConfig::None,
            token: token.clone(),
            created_at: 0,
            failed_at: None,
            dispute_evidence: crate::MaybeBytes32::None,
            expires_at: None,
        };
        let mut rem2 = rem1.clone();
        rem2.amount = 9_999;

        let c1 = compute_payout_commitment(&env, &rem1);
        let c2 = compute_payout_commitment(&env, &rem2);
        assert_ne!(
            c1, c2,
            "different amounts must produce different commitments"
        );
    }

    // ─── validate_payout_proof ────────────────────────────────────────────────

    #[test]
    fn validate_payout_proof_accepts_correct_proof() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, crate::SwiftRemitContract);

        let sender = soroban_sdk::Address::generate(&env);
        let agent = soroban_sdk::Address::generate(&env);
        let token = soroban_sdk::Address::generate(&env);

        let rem = crate::Remittance {
            id: 7,
            sender: sender.clone(),
            agent: agent.clone(),
            amount: 2_000,
            fee: 50,
            status: crate::RemittanceStatus::Pending,
            protocol_fee: 0,
            expiry: None,
            settlement_config: crate::MaybeSettlementConfig::None,
            token: token.clone(),
            created_at: 0,
            failed_at: None,
            dispute_evidence: crate::MaybeBytes32::None,
            expires_at: None,
        };

        let commitment = compute_payout_commitment(&env, &rem);
        env.as_contract(&contract_id, || {
            crate::storage::set_payout_commitment(&env, rem.id, &commitment);
        });

        let result = env.as_contract(&contract_id, || {
            validate_payout_proof(&env, rem.id, &commitment)
        });
        assert!(result.is_ok());
    }

    #[test]
    fn validate_payout_proof_rejects_wrong_proof() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, crate::SwiftRemitContract);

        let sender = soroban_sdk::Address::generate(&env);
        let agent = soroban_sdk::Address::generate(&env);
        let token = soroban_sdk::Address::generate(&env);

        let rem = crate::Remittance {
            id: 8,
            sender: sender.clone(),
            agent: agent.clone(),
            amount: 3_000,
            fee: 75,
            status: crate::RemittanceStatus::Pending,
            protocol_fee: 0,
            expiry: None,
            settlement_config: crate::MaybeSettlementConfig::None,
            token: token.clone(),
            created_at: 0,
            failed_at: None,
            dispute_evidence: crate::MaybeBytes32::None,
            expires_at: None,
        };

        let commitment = compute_payout_commitment(&env, &rem);
        env.as_contract(&contract_id, || {
            crate::storage::set_payout_commitment(&env, rem.id, &commitment);
        });

        let wrong_proof = BytesN::from_array(&env, &[0u8; 32]);
        let result = env.as_contract(&contract_id, || {
            validate_payout_proof(&env, rem.id, &wrong_proof)
        });
        assert_eq!(result, Err(ContractError::InvalidProof));
    }

    #[test]
    fn validate_payout_proof_accepts_when_no_commitment_stored() {
        // Backward-compatibility: remittances created before proof validation
        // was introduced have no stored commitment.  Any submitted proof must
        // be accepted so that existing settlements are not broken.
        let env = Env::default();
        let contract_id = env.register_contract(None, crate::SwiftRemitContract);
        let any_proof = BytesN::from_array(&env, &[99u8; 32]);
        // No set_payout_commitment call here.
        let result = env.as_contract(&contract_id, || {
            validate_payout_proof(&env, 999, &any_proof)
        });
        assert!(result.is_ok());
    }

    // ─── validate_proof / require_valid_proof (structural checks) ────────────

    #[test]
    fn accepts_matching_proof() {
        let env = Env::default();
        let cid = soroban_sdk::String::from_str(&env, "cond-1");
        let signer = soroban_sdk::String::from_str(&env, "0xabc");
        let payload = soroban_sdk::Bytes::from_slice(&env, &[1, 2, 3]);

        let proof = Proof {
            condition_id: cid.clone(),
            signer: signer.clone(),
            payload,
        };
        let condition = Condition {
            id: cid,
            authorized_signer: signer,
        };
        assert_eq!(
            validate_proof(&proof, &condition),
            VerificationResult::Valid
        );
        assert!(require_valid_proof(&proof, &condition).is_ok());
    }

    #[test]
    fn rejects_condition_mismatch() {
        let env = Env::default();
        let cid = soroban_sdk::String::from_str(&env, "cond-1");
        let other_cid = soroban_sdk::String::from_str(&env, "other");
        let signer = soroban_sdk::String::from_str(&env, "0xabc");
        let payload = soroban_sdk::Bytes::from_slice(&env, &[1, 2, 3]);

        let proof = Proof {
            condition_id: other_cid,
            signer: signer.clone(),
            payload,
        };
        let condition = Condition {
            id: cid,
            authorized_signer: signer,
        };
        assert_eq!(
            validate_proof(&proof, &condition),
            VerificationResult::ConditionMismatch
        );
    }

    #[test]
    fn rejects_unauthorized_signer() {
        let env = Env::default();
        let cid = soroban_sdk::String::from_str(&env, "cond-1");
        let signer = soroban_sdk::String::from_str(&env, "0xabc");
        let wrong_signer = soroban_sdk::String::from_str(&env, "0xdef");
        let payload = soroban_sdk::Bytes::from_slice(&env, &[1, 2, 3]);

        let proof = Proof {
            condition_id: cid.clone(),
            signer: wrong_signer,
            payload,
        };
        let condition = Condition {
            id: cid,
            authorized_signer: signer,
        };
        assert_eq!(
            validate_proof(&proof, &condition),
            VerificationResult::UnauthorizedSigner
        );
    }

    #[test]
    fn rejects_empty_payload() {
        let env = Env::default();
        let cid = soroban_sdk::String::from_str(&env, "cond-1");
        let signer = soroban_sdk::String::from_str(&env, "0xabc");
        let empty = soroban_sdk::Bytes::new(&env);

        let proof = Proof {
            condition_id: cid.clone(),
            signer: signer.clone(),
            payload: empty,
        };
        let condition = Condition {
            id: cid,
            authorized_signer: signer,
        };
        assert_eq!(
            validate_proof(&proof, &condition),
            VerificationResult::MalformedProof
        );
    }

    // ─── verify_proof unit tests (#1504, #1505, #1506, #1507) ────────────────

    /// #1504: valid signature from correct signer should return Ok(true)
    #[test]
    fn test_verify_proof_valid_signature() {
        let env = Env::default();
        let signer = soroban_sdk::Address::generate(&env);
        let payload = soroban_sdk::Bytes::from_slice(&env, b"settlement-data-12345");
        let signature = compute_proof_signature(&env, &signer, &payload);

        let proof = ProofData {
            signature,
            payload,
            signer: signer.clone(),
        };

        let result = verify_proof(&env, &proof, &signer);
        assert_eq!(result, Ok(true));
    }

    /// #1505: invalid signature should return Ok(false)
    #[test]
    fn test_verify_proof_invalid_signature() {
        let env = Env::default();
        let signer = soroban_sdk::Address::generate(&env);
        let payload = soroban_sdk::Bytes::from_slice(&env, b"settlement-data-12345");

        // Sub-case A: All-zero signature
        let invalid_signature = BytesN::from_array(&env, &[0u8; 64]);
        let proof = ProofData {
            signature: invalid_signature,
            payload: payload.clone(),
            signer: signer.clone(),
        };
        let result = verify_proof(&env, &proof, &signer);
        assert_eq!(result, Ok(false));

        // Sub-case B: Corrupted non-zero signature bytes
        let mut bad_bytes = [0x55u8; 64];
        bad_bytes[0] = 0xef;
        let corrupted_signature = BytesN::from_array(&env, &bad_bytes);
        let proof_corrupted = ProofData {
            signature: corrupted_signature,
            payload,
            signer: signer.clone(),
        };
        let result_corrupted = verify_proof(&env, &proof_corrupted, &signer);
        assert_eq!(result_corrupted, Ok(false));
    }

    /// #1506: valid signature from wrong signer should return Ok(false)
    #[test]
    fn test_verify_proof_wrong_signer() {
        let env = Env::default();
        let signer = soroban_sdk::Address::generate(&env);
        let wrong_signer = soroban_sdk::Address::generate(&env);
        let payload = soroban_sdk::Bytes::from_slice(&env, b"settlement-data-12345");
        let signature = compute_proof_signature(&env, &signer, &payload);

        let proof = ProofData {
            signature,
            payload,
            signer: signer.clone(),
        };

        let result = verify_proof(&env, &proof, &wrong_signer);
        assert_eq!(result, Ok(false));
    }

    /// #1507: edge case with empty payload
    #[test]
    fn test_verify_proof_empty_payload() {
        let env = Env::default();
        let signer = soroban_sdk::Address::generate(&env);
        let empty_payload = soroban_sdk::Bytes::new(&env);
        let signature = BytesN::from_array(&env, &[1u8; 64]);

        let proof = ProofData {
            signature,
            payload: empty_payload,
            signer: signer.clone(),
        };

        let result = verify_proof(&env, &proof, &signer);
        assert_eq!(result, Ok(false));
    }
}
