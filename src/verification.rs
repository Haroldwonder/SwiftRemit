//! Off-chain proof validation logic.
//!
//! This module provides the building blocks for verifying that off-chain /
//! oracle conditions were satisfied before a settlement is executed. It is
//! intentionally self-contained so that callers (e.g. `confirm_payout`) can
//! validate a proof without depending on any particular oracle transport.
//!
//! See `.kiro/specs/off-chain-verification-proof-validation/` for the full
//! design and requirement references.

use crate::errors::Error;

/// A cryptographic proof attesting to an off-chain / oracle condition.
///
/// The proof is opaque to this module: it is produced off-chain and only
/// needs to be validated against the expected condition and signer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proof {
    /// Identifier of the condition this proof is meant to satisfy.
    pub condition_id: String,
    /// Address (or public key) of the entity that signed the proof.
    pub signer: String,
    /// Raw proof payload (e.g. a signature over the condition).
    pub payload: Vec<u8>,
}

/// The off-chain condition a [`Proof`] is expected to satisfy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Condition {
    /// Identifier of the condition.
    pub id: String,
    /// Address (or public key) authorized to sign for this condition.
    pub authorized_signer: String,
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
/// This performs the structural checks that are independent of any specific
/// signature scheme: the proof must reference the expected condition, be
/// signed by the authorized signer, and carry a non-empty payload. Scheme
/// specific cryptographic verification is layered on top by callers.
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
/// returning an [`Error`] when the proof is not valid.
///
/// Callers that need to branch on the specific failure reason should use
/// [`validate_proof`] directly.
pub fn require_valid_proof(proof: &Proof, condition: &Condition) -> Result<(), Error> {
    match validate_proof(proof, condition) {
        VerificationResult::Valid => Ok(()),
        VerificationResult::ConditionMismatch => Err(Error::ProofConditionMismatch),
        VerificationResult::UnauthorizedSigner => Err(Error::ProofUnauthorizedSigner),
        VerificationResult::MalformedProof => Err(Error::ProofMalformed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn condition() -> Condition {
        Condition {
            id: "cond-1".to_string(),
            authorized_signer: "0xabc".to_string(),
        }
    }

    fn proof() -> Proof {
        Proof {
            condition_id: "cond-1".to_string(),
            signer: "0xabc".to_string(),
            payload: vec![1, 2, 3],
        }
    }

    #[test]
    fn accepts_matching_proof() {
        assert_eq!(validate_proof(&proof(), &condition()), VerificationResult::Valid);
        assert!(require_valid_proof(&proof(), &condition()).is_ok());
    }

    #[test]
    fn rejects_condition_mismatch() {
        let mut p = proof();
        p.condition_id = "other".to_string();
        assert_eq!(validate_proof(&p, &condition()), VerificationResult::ConditionMismatch);
    }

    #[test]
    fn rejects_unauthorized_signer() {
        let mut p = proof();
        p.signer = "0xdef".to_string();
        assert_eq!(validate_proof(&p, &condition()), VerificationResult::UnauthorizedSigner);
    }

    #[test]
    fn rejects_empty_payload() {
        let mut p = proof();
        p.payload = Vec::new();
        assert_eq!(validate_proof(&p, &condition()), VerificationResult::MalformedProof);
    }
}
