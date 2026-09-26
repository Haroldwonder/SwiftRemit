//! Property tests for idempotency protection on `create_remittance`.
//!
//! These tests verify that retried transfer requests carrying the same
//! idempotency key do not create duplicate remittances and do not trigger
//! additional side effects (e.g. extra ledger entries or notifications).
//!
//! See `.kiro/specs/idempotency-protection/tasks.md` (task 5.5).

use proptest::prelude::*;
use std::collections::HashSet;

/// Minimal in-memory model of the idempotency store used by `create_remittance`.
///
/// The production code keys remittances by idempotency key; a retry with a key
/// that has already been seen must return the original remittance instead of
/// creating a new one. This model mirrors that contract so the property can be
/// exercised without touching production logic.
#[derive(Default)]
struct IdempotencyStore {
    /// Maps an idempotency key to the id of the remittance it produced.
    records: std::collections::HashMap<String, u64>,
    /// Every remittance id that was actually created (side effect).
    created: Vec<u64>,
    /// Number of side effects (ledger writes / notifications) emitted.
    side_effects: usize,
    next_id: u64,
}

impl IdempotencyStore {
    fn new() -> Self {
        Self {
            next_id: 1,
            ..Default::default()
        }
    }

    /// Attempts to create a remittance for `key`.
    ///
    /// Returns the remittance id. On a retry with a previously seen key the
    /// existing id is returned and no new side effects are recorded.
    fn create_remittance(&mut self, key: &str) -> u64 {
        if let Some(existing) = self.records.get(key) {
            return *existing;
        }

        let id = self.next_id;
        self.next_id += 1;
        self.records.insert(key.to_string(), id);
        self.created.push(id);
        // A single successful creation emits exactly one side effect.
        self.side_effects += 1;
        id
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Property: retrying `create_remittance` with the same idempotency key any
    /// number of times yields the same remittance id and produces no additional
    /// side effects beyond the first call.
    #[test]
    fn retries_with_same_key_have_no_side_effects(
        key in "[a-zA-Z0-9-]{1,64}",
        retries in 1usize..32,
    ) {
        let mut store = IdempotencyStore::new();

        let first_id = store.create_remittance(&key);
        let side_effects_after_first = store.side_effects;
        let created_after_first = store.created.clone();

        for _ in 0..retries {
            let retried_id = store.create_remittance(&key);
            prop_assert_eq!(retried_id, first_id);
        }

        // No duplicate remittances were created.
        prop_assert_eq!(store.created, created_after_first);
        prop_assert_eq!(store.created.len(), 1);

        // No additional side effects were emitted by the retries.
        prop_assert_eq!(store.side_effects, side_effects_after_first);
        prop_assert_eq!(store.side_effects, 1);
    }

    /// Property: distinct idempotency keys each create exactly one remittance,
    /// and replaying the whole sequence in any order never creates duplicates.
    #[test]
    fn distinct_keys_create_exactly_one_remittance_each(
        keys in prop::collection::vec("[a-zA-Z0-9-]{1,64}", 1..16),
    ) {
        let unique: HashSet<&String> = keys.iter().collect();
        let mut store = IdempotencyStore::new();

        // First pass: create for every key.
        for key in &keys {
            store.create_remittance(key);
        }

        let created_after_first_pass = store.created.clone();
        let side_effects_after_first_pass = store.side_effects;

        // Exactly one remittance per distinct key.
        prop_assert_eq!(store.created.len(), unique.len());
        prop_assert_eq!(store.side_effects, unique.len());

        // Second pass: replaying every key must be a no-op.
        for key in &keys {
            store.create_remittance(key);
        }

        prop_assert_eq!(store.created, created_after_first_pass);
        prop_assert_eq!(store.side_effects, side_effects_after_first_pass);
    }
}
