use serde::Serialize;
use sha2::{Digest, Sha256};

/// Computes a deterministic, canonical hash of a transfer request payload.
///
/// Identical retried requests (same fields, same values) must produce the same
/// hash so that idempotency checks can detect duplicates. Field ordering is
/// normalized by serializing into a canonical JSON representation before
/// hashing.
pub fn compute_request_hash<T: Serialize>(request: &T) -> String {
    let canonical = canonical_json(request);
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let digest = hasher.finalize();
    hex_encode(&digest)
}

/// Serializes a value into a canonical JSON string with object keys sorted
/// recursively, ensuring a stable byte representation regardless of the
/// original field ordering.
fn canonical_json<T: Serialize>(value: &T) -> String {
    let json = serde_json::to_value(value).unwrap_or(serde_json::Value::Null);
    let canonical = sort_value(json);
    serde_json::to_string(&canonical).unwrap_or_default()
}

/// Recursively sorts object keys so serialization is deterministic.
fn sort_value(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut sorted: Vec<(String, serde_json::Value)> = map.into_iter().collect();
            sorted.sort_by(|a, b| a.0.cmp(&b.0));
            let mut out = serde_json::Map::with_capacity(sorted.len());
            for (key, val) in sorted {
                out.insert(key, sort_value(val));
            }
            serde_json::Value::Object(out)
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.into_iter().map(sort_value).collect())
        }
        other => other,
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;

    #[derive(Serialize)]
    struct Sample {
        amount: u64,
        currency: String,
        recipient: String,
    }

    #[test]
    fn identical_requests_produce_identical_hashes() {
        let a = Sample {
            amount: 100,
            currency: "USD".to_string(),
            recipient: "acct_123".to_string(),
        };
        let b = Sample {
            amount: 100,
            currency: "USD".to_string(),
            recipient: "acct_123".to_string(),
        };
        assert_eq!(compute_request_hash(&a), compute_request_hash(&b));
    }

    #[test]
    fn different_requests_produce_different_hashes() {
        let a = Sample {
            amount: 100,
            currency: "USD".to_string(),
            recipient: "acct_123".to_string(),
        };
        let b = Sample {
            amount: 101,
            currency: "USD".to_string(),
            recipient: "acct_123".to_string(),
        };
        assert_ne!(compute_request_hash(&a), compute_request_hash(&b));
    }

    #[test]
    fn hash_is_stable_across_key_ordering() {
        let a: serde_json::Value = serde_json::json!({
            "amount": 100,
            "currency": "USD",
            "recipient": "acct_123"
        });
        let b: serde_json::Value = serde_json::json!({
            "recipient": "acct_123",
            "currency": "USD",
            "amount": 100
        });
        assert_eq!(compute_request_hash(&a), compute_request_hash(&b));
    }
}
