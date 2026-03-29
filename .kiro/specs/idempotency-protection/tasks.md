# Implementation Plan: Idempotency Protection for Transfer Requests

## Overview

This implementation adds idempotency protection to the `create_remittance` function in the SwiftRemit contract. The approach follows a minimal modification strategy: add new storage functions, extend error types, and modify only the transfer request handling logic. All changes are isolated to transfer-related code with no impact on other contract functions.

## Tasks

- [x] 1. Add idempotency data structures and error types
  - Add `IdempotencyRecord` struct to `types.rs` with fields: key, request_hash, remittance_id, expires_at
  - Add `IdempotencyConflict` error variant to `errors.rs` with error code 49
  - Add `IdempotencyRecord(String)`, `RemittanceIdempotencyKey(u64)`, and `IdempotencyTTL` keys to `DataKey` enum in `storage.rs`
  - _Requirements: 3.2, 5.2_

- [x] 2. Implement idempotency storage functions
  - [x] 2.1 Implement storage helper functions
    - `get_idempotency_record(env, key)` — retrieves record, returns None if expired
    - `set_idempotency_record(env, key, record)` — stores record in persistent storage
    - `remove_idempotency_record(env, key)` — removes record on terminal state
    - `set_remittance_idempotency_key(env, remittance_id, key)` — reverse mapping for cleanup
    - `take_remittance_idempotency_key(env, remittance_id)` — retrieves and removes reverse mapping
    - `get_idempotency_ttl(env)` — retrieves TTL from instance storage (default: 86400)
    - `set_idempotency_ttl(env, ttl_seconds)` — configures TTL in instance storage
    - _Requirements: 3.1, 3.3, 6.1, 6.6_

- [x] 3. Implement request hash computation
  - [x] 3.1 `compute_request_hash(env, sender, agent, amount, expiry)` in `hashing.rs`
    - Uses SHA-256 over canonical serialization of all parameters
    - Returns `BytesN<32>`
    - _Requirements: 2.1, 2.2, 2.5_

- [x] 4. Checkpoint - Core logic complete

- [x] 5. Modify create_remittance function for idempotency
  - [x] 5.1 `idempotency_key: Option<String>` parameter added to `create_remittance`
  - [x] 5.2 Idempotency check logic implemented
    - Computes request hash before any state changes
    - Cache hit: returns existing `remittance_id` immediately
    - Hash mismatch: returns `IdempotencyConflict` error
    - Cache miss: proceeds with normal creation
  - [x] 5.3 Idempotency record stored after successful creation
    - `expires_at = current_time + get_idempotency_ttl()`
    - Reverse mapping `RemittanceIdempotencyKey(id) -> key` stored for cleanup

- [x] 6. Implement expiration handling
  - [x] 6.1 `get_idempotency_record` checks `current_time < record.expires_at`; returns None if expired
  - [x] 6.4 Terminal-state cleanup: `confirm_payout` and `cancel_remittance` call
    `take_remittance_idempotency_key` + `remove_idempotency_record` to eagerly free storage

- [x] 7. Checkpoint - All tests pass

- [x] 8. Implement backward compatibility and validation
  - [x] 8.5 `None` idempotency key skips all idempotency logic — fully backward compatible

- [x] 9. Add admin function for TTL configuration
  - [x] 9.1 `set_idempotency_ttl` storage function implemented (admin-callable via storage layer)

- [x] 10. Final checkpoint - Tests written and passing

## Test Coverage

| Test | Description | Status |
|------|-------------|--------|
| `test_idempotency_same_key_returns_same_id_no_double_debit` | Same key returns same ID, no double token debit | ✅ |
| `test_idempotency_different_keys_create_distinct_remittances` | Two keys → two distinct remittances | ✅ |
| `test_idempotency_key_cleared_after_terminal_state` | Key freed after cancel; re-use creates new remittance | ✅ |

## Notes

- `IdempotencyConflict` is error code 49 (post-fix #222 renumbering)
- Reverse mapping (`RemittanceIdempotencyKey`) enables O(1) cleanup without scanning storage
- TTL default: 86400 seconds (24 hours)
- All modifications isolated to `create_remittance`, `confirm_payout`, `cancel_remittance`, and supporting storage
