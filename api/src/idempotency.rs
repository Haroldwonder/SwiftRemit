//! Idempotency protection for transfer requests.
//!
//! Provides storage and lookup of idempotency keys so that retried transfer
//! requests (e.g. `create_remittance`) with the same key do not create
//! duplicate remittances.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

/// Default time-to-live for stored idempotency records.
pub const DEFAULT_TTL_SECONDS: u64 = 24 * 60 * 60;

/// Minimum allowed TTL for idempotency records (1 minute).
pub const MIN_TTL_SECONDS: u64 = 60;

/// Maximum allowed TTL for idempotency records (30 days).
pub const MAX_TTL_SECONDS: u64 = 30 * 24 * 60 * 60;

/// A stored idempotency record.
#[derive(Clone, Debug)]
pub struct IdempotencyRecord {
    /// The stored response payload associated with the key.
    pub response: String,
    /// When the record was created.
    pub created_at: SystemTime,
}

impl IdempotencyRecord {
    /// Returns true if the record has outlived the given TTL.
    pub fn is_expired(&self, ttl: Duration) -> bool {
        match self.created_at.elapsed() {
            Ok(age) => age > ttl,
            Err(_) => false,
        }
    }
}

/// In-memory idempotency store.
#[derive(Debug)]
pub struct IdempotencyStore {
    records: Mutex<HashMap<String, IdempotencyRecord>>,
    ttl: Mutex<Duration>,
}

impl Default for IdempotencyStore {
    fn default() -> Self {
        Self::new()
    }
}

impl IdempotencyStore {
    /// Creates a new store using the default TTL.
    pub fn new() -> Self {
        Self {
            records: Mutex::new(HashMap::new()),
            ttl: Mutex::new(Duration::from_secs(DEFAULT_TTL_SECONDS)),
        }
    }

    /// Returns the currently configured TTL.
    pub fn ttl(&self) -> Duration {
        *self.ttl.lock().expect("ttl mutex poisoned")
    }

    /// Looks up a non-expired record for the given key.
    pub fn get(&self, key: &str) -> Option<IdempotencyRecord> {
        let ttl = self.ttl();
        let records = self.records.lock().expect("records mutex poisoned");
        records.get(key).and_then(|record| {
            if record.is_expired(ttl) {
                None
            } else {
                Some(record.clone())
            }
        })
    }

    /// Stores a response for the given key.
    pub fn put(&self, key: &str, response: String) {
        let mut records = self.records.lock().expect("records mutex poisoned");
        records.insert(
            key.to_string(),
            IdempotencyRecord {
                response,
                created_at: SystemTime::now(),
            },
        );
    }

    /// Removes all expired records.
    pub fn purge_expired(&self) {
        let ttl = self.ttl();
        let mut records = self.records.lock().expect("records mutex poisoned");
        records.retain(|_, record| !record.is_expired(ttl));
    }
}

/// Errors returned by the TTL admin configuration function.
#[derive(Debug, PartialEq, Eq)]
pub enum TtlConfigError {
    /// The requested TTL is below [`MIN_TTL_SECONDS`].
    TooShort(u64),
    /// The requested TTL is above [`MAX_TTL_SECONDS`].
    TooLong(u64),
}

impl std::fmt::Display for TtlConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TtlConfigError::TooShort(secs) => write!(
                f,
                "idempotency TTL of {}s is below the minimum of {}s",
                secs, MIN_TTL_SECONDS
            ),
            TtlConfigError::TooLong(secs) => write!(
                f,
                "idempotency TTL of {}s is above the maximum of {}s",
                secs, MAX_TTL_SECONDS
            ),
        }
    }
}

impl std::error::Error for TtlConfigError {}

/// Admin function to configure the idempotency record TTL.
///
/// Validates that `ttl_seconds` falls within the allowed range and, on
/// success, updates the store's TTL and purges any records that are now
/// expired. Returns the previously configured TTL on success.
pub fn set_idempotency_ttl(
    store: &IdempotencyStore,
    ttl_seconds: u64,
) -> Result<Duration, TtlConfigError> {
    if ttl_seconds < MIN_TTL_SECONDS {
        return Err(TtlConfigError::TooShort(ttl_seconds));
    }
    if ttl_seconds > MAX_TTL_SECONDS {
        return Err(TtlConfigError::TooLong(ttl_seconds));
    }

    let new_ttl = Duration::from_secs(ttl_seconds);
    let previous = {
        let mut ttl = store.ttl.lock().expect("ttl mutex poisoned");
        let previous = *ttl;
        *ttl = new_ttl;
        previous
    };

    store.purge_expired();
    Ok(previous)
}

/// Admin function to read the currently configured idempotency TTL.
pub fn get_idempotency_ttl(store: &IdempotencyStore) -> Duration {
    store.ttl()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_ttl_is_used_on_new_store() {
        let store = IdempotencyStore::new();
        assert_eq!(store.ttl(), Duration::from_secs(DEFAULT_TTL_SECONDS));
    }

    #[test]
    fn set_ttl_updates_and_returns_previous() {
        let store = IdempotencyStore::new();
        let previous = set_idempotency_ttl(&store, 3600).expect("valid ttl");
        assert_eq!(previous, Duration::from_secs(DEFAULT_TTL_SECONDS));
        assert_eq!(get_idempotency_ttl(&store), Duration::from_secs(3600));
    }

    #[test]
    fn set_ttl_rejects_too_short() {
        let store = IdempotencyStore::new();
        let err = set_idempotency_ttl(&store, MIN_TTL_SECONDS - 1).unwrap_err();
        assert_eq!(err, TtlConfigError::TooShort(MIN_TTL_SECONDS - 1));
        assert_eq!(store.ttl(), Duration::from_secs(DEFAULT_TTL_SECONDS));
    }

    #[test]
    fn set_ttl_rejects_too_long() {
        let store = IdempotencyStore::new();
        let err = set_idempotency_ttl(&store, MAX_TTL_SECONDS + 1).unwrap_err();
        assert_eq!(err, TtlConfigError::TooLong(MAX_TTL_SECONDS + 1));
        assert_eq!(store.ttl(), Duration::from_secs(DEFAULT_TTL_SECONDS));
    }

    #[test]
    fn set_ttl_accepts_boundaries() {
        let store = IdempotencyStore::new();
        assert!(set_idempotency_ttl(&store, MIN_TTL_SECONDS).is_ok());
        assert!(set_idempotency_ttl(&store, MAX_TTL_SECONDS).is_ok());
    }

    #[test]
    fn lowering_ttl_purges_expired_records() {
        let store = IdempotencyStore::new();
        store.put("key-1", "response".to_string());
        // Force the record to look old by rewriting its created_at.
        {
            let mut records = store.records.lock().unwrap();
            if let Some(record) = records.get_mut("key-1") {
                record.created_at = SystemTime::now() - Duration::from_secs(120);
            }
        }
        set_idempotency_ttl(&store, MIN_TTL_SECONDS).expect("valid ttl");
        assert!(store.get("key-1").is_none());
    }
}
