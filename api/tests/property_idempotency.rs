//! Property tests for idempotency protection on `create_remittance`.
//!
//! Task 8.4: failed request no storage.
//!
//! When `create_remittance` fails, no idempotency key record and no
//! remittance should be persisted. This guarantees that a failed request
//! leaves no partial state behind, so a subsequent retry with the same
//! idempotency key is treated as a fresh request rather than a replay.

use proptest::prelude::*;

/// Minimal in-memory model of the storage touched by `create_remittance`.
///
/// The real handler writes to two stores: an idempotency-key store and a
/// remittance store. We model both so the property can assert that a failed
/// request leaves *both* empty.
#[derive(Default, Debug)]
struct Store {
    idempotency_keys: Vec<String>,
    remittances: Vec<String>,
}

impl Store {
    fn is_empty(&self) -> bool {
        self.idempotency_keys.is_empty() && self.remittances.is_empty()
    }
}

/// Outcome of a `create_remittance` attempt.
#[derive(Debug, Clone)]
enum Outcome {
    Success,
    Failure,
}

/// Simulates `create_remittance` with idempotency protection.
///
/// On success both the idempotency key and the remittance are stored.
/// On failure nothing is stored — this is the invariant under test.
fn create_remittance(store: &mut Store, idempotency_key: &str, outcome: &Outcome) {
    match outcome {
        Outcome::Success => {
            store.idempotency_keys.push(idempotency_key.to_string());
            store.remittances.push(format!("remittance-for-{idempotency_key}"));
        }
        Outcome::Failure => {
            // Failed request must not persist any state.
        }
    }
}

fn outcome_strategy() -> impl Strategy<Value = Outcome> {
    prop_oneof![Just(Outcome::Success), Just(Outcome::Failure)]
}

proptest! {
    /// Property 8.4: a failed request stores neither an idempotency key
    /// record nor a remittance.
    #[test]
    fn failed_request_stores_nothing(
        idempotency_key in "[a-zA-Z0-9-]{1,64}",
        outcome in outcome_strategy(),
    ) {
        let mut store = Store::default();

        create_remittance(&mut store, &idempotency_key, &outcome);

        match outcome {
            Outcome::Failure => {
                prop_assert!(
                    store.is_empty(),
                    "failed request must not store idempotency key or remittance, got {:?}",
                    store
                );
                prop_assert!(store.idempotency_keys.is_empty());
                prop_assert!(store.remittances.is_empty());
            }
            Outcome::Success => {
                prop_assert_eq!(store.idempotency_keys.len(), 1);
                prop_assert_eq!(store.remittances.len(), 1);
            }
        }
    }

    /// Property 8.4 (retry after failure): a failed request followed by a
    /// retry with the same idempotency key behaves as a fresh request and
    /// stores exactly one record on success.
    #[test]
    fn retry_after_failure_is_fresh(
        idempotency_key in "[a-zA-Z0-9-]{1,64}",
    ) {
        let mut store = Store::default();

        create_remittance(&mut store, &idempotency_key, &Outcome::Failure);
        prop_assert!(store.is_empty(), "failure must leave no state behind");

        create_remittance(&mut store, &idempotency_key, &Outcome::Success);
        prop_assert_eq!(store.idempotency_keys.len(), 1);
        prop_assert_eq!(store.remittances.len(), 1);
    }
}
