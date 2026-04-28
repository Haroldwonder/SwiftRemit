//! Off-chain proof verification helpers for payout confirmation.
//!
//! The on-chain scheme stores a per-remittance payout commitment as SHA-256 bytes.
//! Agents submit the same 32-byte value in `confirm_payout`; the proof is valid
//! when it matches the stored commitment exactly.

use soroban_sdk::{BytesN, Env};

/// Build the deterministic payout commitment for a remittance.
///
/// The commitment is derived from the canonical settlement hash schema so agents can
/// generate the same value off-chain from remittance details.
pub fn compute_payout_commitment(env: &Env, remittance: &crate::Remittance) -> BytesN<32> {
    crate::hashing::compute_settlement_id_from_remittance(env, remittance)
}

/// Verify a submitted proof against a stored payout commitment.
pub fn verify_proof_commitment(submitted: &BytesN<32>, expected: &BytesN<32>) -> bool {
    submitted == expected
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn test_verify_proof_commitment_mismatch() {
        let env = Env::default();
        let expected = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);
        let submitted = soroban_sdk::BytesN::from_array(&env, &[2u8; 32]);
        assert!(!verify_proof_commitment(&submitted, &expected));
    }

    #[test]
    fn test_compute_and_verify_proof_commitment() {
        let env = Env::default();
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let remittance = crate::Remittance {
            id: 7,
            sender,
            agent,
            amount: 5000,
            fee: 125,
            status: crate::RemittanceStatus::Pending,
            expiry: None,
            settlement_config: None,
        };

        let commitment = compute_payout_commitment(&env, &remittance);
        assert!(verify_proof_commitment(&commitment, &commitment));
    }
}
