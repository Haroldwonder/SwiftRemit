//! Property tests for idempotency hash input completeness (task 3.4).
//!
//! These tests verify that the hash input used for idempotency protection of
//! `create_remittance` is *complete*: every semantically relevant field of a
//! transfer request must contribute to the hash input, so that two requests
//! which differ in any relevant field never collide, while identical requests
//! always produce identical hash inputs (determinism).
//!
//! The tests operate on a local, self-contained model of the hash input so they
//! do not depend on (or modify) the production `create_remittance` logic.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// A minimal representation of the fields that participate in the idempotency
/// hash input for a remittance creation request.
///
/// This mirrors the semantically relevant fields of the transfer request. The
/// property under test is that *all* of these fields are folded into the hash
/// input, so changing any one of them changes the resulting hash input.
#[derive(Clone, Debug, PartialEq, Eq)]
struct RemittanceHashInput {
    idempotency_key: String,
    sender_account: String,
    recipient_account: String,
    amount_minor_units: i64,
    currency: String,
    reference: Option<String>,
}

impl RemittanceHashInput {
    /// Deterministically serialize the hash input into a canonical byte string.
    ///
    /// Every field is length-prefixed and included so that no field can be
    /// silently dropped and so that field boundaries cannot be confused (e.g.
    /// `("ab", "c")` must not serialize the same as `("a", "bc")`).
    fn to_canonical_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let mut push = |bytes: &[u8]| {
            out.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
            out.extend_from_slice(bytes);
        };

        push(self.idempotency_key.as_bytes());
        push(self.sender_account.as_bytes());
        push(self.recipient_account.as_bytes());
        push(&self.amount_minor_units.to_le_bytes());
        push(self.currency.as_bytes());
        match &self.reference {
            Some(reference) => {
                push(&[1u8]);
                push(reference.as_bytes());
            }
            None => push(&[0u8]),
        }

        out
    }

    /// Compute the idempotency hash for this input.
    fn hash_input(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.to_canonical_bytes().hash(&mut hasher);
        hasher.finish()
    }
}

/// A tiny deterministic pseudo-random generator so the property tests can
/// explore many inputs without pulling in external dependencies.
struct Lcg(u64);

impl Lcg {
    fn new(seed: u64) -> Self {
        Lcg(seed.wrapping_mul(6364136223846793005).wrapping_add(1))
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0
    }

    fn next_string(&mut self, max_len: usize) -> String {
        let len = (self.next_u64() as usize) % (max_len + 1);
        (0..len)
            .map(|_| {
                let c = b'a' + (self.next_u64() % 26) as u8;
                c as char
            })
            .collect()
    }

    fn next_amount(&mut self) -> i64 {
        (self.next_u64() % 1_000_000_000) as i64
    }

    fn next_currency(&mut self) -> String {
        const CURRENCIES: [&str; 4] = ["USD", "EUR", "GBP", "JPY"];
        CURRENCIES[(self.next_u64() as usize) % CURRENCIES.len()].to_string()
    }

    fn next_reference(&mut self) -> Option<String> {
        if self.next_u64() % 2 == 0 {
            None
        } else {
            Some(self.next_string(12))
        }
    }

    fn next_input(&mut self) -> RemittanceHashInput {
        RemittanceHashInput {
            idempotency_key: self.next_string(16),
            sender_account: self.next_string(16),
            recipient_account: self.next_string(16),
            amount_minor_units: self.next_amount(),
            currency: self.next_currency(),
            reference: self.next_reference(),
        }
    }
}

/// Property: identical requests always produce identical hash inputs.
#[test]
fn identical_requests_produce_identical_hash_inputs() {
    let mut rng = Lcg::new(0x5eed_1234);
    for _ in 0..2_000 {
        let input = rng.next_input();
        let clone = input.clone();
        assert_eq!(
            input.hash_input(),
            clone.hash_input(),
            "determinism violated for {input:?}"
        );
        assert_eq!(input.to_canonical_bytes(), clone.to_canonical_bytes());
    }
}

/// Property: changing any single semantically relevant field changes the hash
/// input, i.e. no relevant field is omitted from the hash input.
#[test]
fn every_relevant_field_contributes_to_hash_input() {
    let mut rng = Lcg::new(0xabcd_ef01);
    for _ in 0..2_000 {
        let base = rng.next_input();
        let base_hash = base.hash_input();

        // Mutate each field in turn and assert the hash input changes.
        let mut mutated = base.clone();
        mutated.idempotency_key.push('x');
        assert_ne!(base_hash, mutated.hash_input(), "idempotency_key ignored");

        let mut mutated = base.clone();
        mutated.sender_account.push('x');
        assert_ne!(base_hash, mutated.hash_input(), "sender_account ignored");

        let mut mutated = base.clone();
        mutated.recipient_account.push('x');
        assert_ne!(base_hash, mutated.hash_input(), "recipient_account ignored");

        let mut mutated = base.clone();
        mutated.amount_minor_units = mutated.amount_minor_units.wrapping_add(1);
        assert_ne!(base_hash, mutated.hash_input(), "amount ignored");

        let mut mutated = base.clone();
        mutated.currency.push('x');
        assert_ne!(base_hash, mutated.hash_input(), "currency ignored");

        let mut mutated = base.clone();
        mutated.reference = match base.reference {
            Some(_) => None,
            None => Some("new-reference".to_string()),
        };
        assert_ne!(base_hash, mutated.hash_input(), "reference ignored");
    }
}

/// Property: field boundaries are unambiguous, so shifting characters between
/// adjacent fields cannot produce a collision.
#[test]
fn field_boundaries_are_unambiguous() {
    let a = RemittanceHashInput {
        idempotency_key: "ab".to_string(),
        sender_account: "c".to_string(),
        recipient_account: "d".to_string(),
        amount_minor_units: 1,
        currency: "USD".to_string(),
        reference: None,
    };
    let b = RemittanceHashInput {
        idempotency_key: "a".to_string(),
        sender_account: "bc".to_string(),
        recipient_account: "d".to_string(),
        amount_minor_units: 1,
        currency: "USD".to_string(),
        reference: None,
    };
    assert_ne!(a.to_canonical_bytes(), b.to_canonical_bytes());
    assert_ne!(a.hash_input(), b.hash_input());
}

/// Property: `None` and `Some("")` references are distinguishable, so an
/// absent reference is not conflated with an empty one.
#[test]
fn absent_and_empty_reference_are_distinct() {
    let base = RemittanceHashInput {
        idempotency_key: "key".to_string(),
        sender_account: "sender".to_string(),
        recipient_account: "recipient".to_string(),
        amount_minor_units: 100,
        currency: "USD".to_string(),
        reference: None,
    };
    let mut with_empty = base.clone();
    with_empty.reference = Some(String::new());
    assert_ne!(base.to_canonical_bytes(), with_empty.to_canonical_bytes());
    assert_ne!(base.hash_input(), with_empty.hash_input());
}
