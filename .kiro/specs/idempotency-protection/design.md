# Design Document: Idempotency Protection for Transfer Requests

## Overview

This design implements idempotency protection for the `create_remittance` function in the SwiftRemit contract. The implementation uses an idempotency key provided by clients to detect and prevent duplicate transfer executions while allowing safe retries.

The design follows these principles:
- Minimal scope: Only modify transfer request handling and supporting storage
- Backward compatibility: Requests without idempotency keys work unchanged
- Deterministic hashing: Detect payload changes even with the same key
- Automatic expiration: Prevent unbounded storage growth with configurable TTL

## Architecture

### High-Level Flow

```
Client Request with Idempotency-Key
         |
         v
Check if key exists in storage
         |
    +----+----+
    |         |
   Yes        No
    |         |
    v         v
Check hash  Store key + hash
match?      Execute transfer
    |       Store response
+---+---+   Return response
|       |
Match  Diff
|       |
v       v
Return  Return
stored  conflict
response error
```

### Component Interaction

1. **create_remittance** (modified): Entry point that checks for idempotency key
2. **Idempotency Storage Module** (new): Manages idempotency record storage and retrieval
3. **Hash Module** (existing): Computes deterministic request hashes
4. **Error Module** (extended): Adds IdempotencyConflict error type

## Components and Interfaces

### 1. Idempotency Record Structure

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdempotencyRecord {
    /// The client-provided idempotency key
    pub key: String,
    
    /// SHA-256 hash of the request payload
    pub request_hash: BytesN<32>,
    
    /// The remittance ID returned from the original request
    pub remittance_id: u64,
    
    /// Timestamp when this record expires (ledger timestamp)
    pub expires_at: u64,
}
```

### 2. Storage Functions

```rust
// Check if an idempotency key exists and is not expired
pub fn get_idempotency_record(
    env: &Env,
    key: &String
) -> Option<IdempotencyRecord>

// Store a new idempotency record
pub fn set_idempotency_record(
    env: &Env,
    key: &String,
    record: &IdempotencyRecord
)

// Get the configured TTL (default: 86400 seconds = 24 hours)
pub fn get_idempotency_ttl(env: &Env) -> u64

// Set the idempotency TTL (admin only)
pub fn set_idempotency_ttl(env: &Env, ttl_seconds: u64)
```

### 3. Hash Computation

```rust
// Compute deterministic hash from request parameters
pub fn compute_request_hash(
    env: &Env,
    sender: &Address,
    agent: &Address,
    amount: i128,
    expiry: Option<u64>
) -> BytesN<32>
```

Uses the existing `hashing` module with SHA-256 to create a deterministic hash from the request parameters.

### 4. Modified create_remittance Function

```rust
pub fn create_remittance(
    env: Env,
    sender: Address,
    agent: Address,
    amount: i128,
    expiry: Option<u64>,
    idempotency_key: Option<String>, // NEW PARAMETER
) -> Result<u64, ContractError>
```

**Logic Flow:**

1. Perform existing validation (sender auth, amount > 0, agent registered)
2. If idempotency_key is Some:
   a. Compute request_hash from (sender, agent, amount, expiry)
   b. Check if idempotency_key exists in storage
   c. If exists and not expired:
      - Compare stored hash with computed hash
      - If match: return stored remittance_id
      - If differ: return IdempotencyConflict error
   d. If not exists or expired: continue to step 3
3. Execute existing transfer logic (token transfer, create remittance, emit events)
4. If idempotency_key is Some:
   a. Calculate expires_at = current_time + TTL
   b. Store IdempotencyRecord with key, hash, remittance_id, expires_at
5. Return remittance_id

### 5. Error Types

Add to `errors.rs`:

```rust
#[contracterror]
pub enum ContractError {
    // ... existing errors ...
    
    /// Idempotency key exists but request payload differs.
    /// Cause: Same idempotency key used with different request parameters.
    IdempotencyConflict = 23,
}
```

## Data Models

### Storage Keys

Add to `storage.rs` DataKey enum:

```rust
enum DataKey {
    // ... existing keys ...
    
    /// Idempotency record indexed by idempotency key (persistent storage)
    IdempotencyRecord(String),
    
    /// Configurable TTL for idempotency records (instance storage)
    IdempotencyTTL,
}
```

### Default Values

- **Default TTL**: 86400 seconds (24 hours)
- **Maximum key length**: 255 characters
- **Hash algorithm**: SHA-256

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: Hash Determinism
*For any* request parameters (sender, agent, amount, expiry), computing the request hash multiple times SHALL produce identical results.
**Validates: Requirements 2.1, 2.3**

### Property 2: Hash Sensitivity
*For any* two different request payloads, the system SHALL generate different request hashes with high probability (collision resistance).
**Validates: Requirements 2.4**

### Property 3: Hash Input Completeness
*For any* request, changing any single field (sender, agent, amount, or expiry) SHALL result in a different request hash.
**Validates: Requirements 2.2**

### Property 4: Idempotent Retry Returns Same Response
*For any* successful transfer request with an idempotency key, retrying the request with the same key and identical payload SHALL return the same remittance_id without creating a new remittance.
**Validates: Requirements 4.2**

### Property 5: Idempotent Retry Has No Side Effects
*For any* successful transfer request with an idempotency key, retrying the request with the same key and identical payload SHALL NOT transfer tokens, increment the remittance counter, or create new remittances.
**Validates: Requirements 4.3, 4.4**

### Property 6: Idempotency Conflict Detection
*For any* idempotency key that already exists, attempting a transfer with the same key but different payload SHALL result in an IdempotencyConflict error without executing the transfer.
**Validates: Requirements 5.2, 5.3**

### Property 7: Expired Keys Allow Re-execution
*For any* idempotency record that has expired (current_time > expires_at), a new transfer request with the same key SHALL execute normally and overwrite the expired record.
**Validates: Requirements 6.3, 6.4, 6.5**

### Property 8: Expiration Timestamp Calculation
*For any* successful transfer with an idempotency key, the stored expiration timestamp SHALL equal the current ledger timestamp plus the configured TTL.
**Validates: Requirements 6.2**

### Property 9: Backward Compatibility
*For any* transfer request without an idempotency key, the system SHALL execute the transfer normally without performing idempotency checks or storing idempotency records.
**Validates: Requirements 1.2, 7.3, 7.4**

### Property 10: Idempotency Key Acceptance
*For any* valid idempotency key (alphanumeric, hyphens, underscores, up to 255 characters), the system SHALL accept and process the key without error.
**Validates: Requirements 1.1, 1.3, 1.4**

### Property 11: Successful Request Storage
*For any* transfer request with an idempotency key that completes successfully, the system SHALL store an idempotency record containing the key, request hash, remittance_id, and expiration timestamp.
**Validates: Requirements 3.1, 3.2**

### Property 12: Failed Request No Storage
*For any* transfer request with an idempotency key that fails validation or execution, the system SHALL NOT store an idempotency record.
**Validates: Requirements 3.4**

## Error Handling

### New Error Types

**IdempotencyConflict (Error Code 23)**
- Triggered when: Same idempotency key used with different request payload
- Response: Include both expected hash (from storage) and actual hash (from request)
- Side effects: No transfer execution, no storage modification
- Client action: Check for programming error or use a different idempotency key

### Existing Error Handling

All existing error conditions remain unchanged:
- InvalidAmount: Still validated before idempotency checks
- AgentNotRegistered: Still validated before idempotency checks
- Overflow: Still checked during fee calculation
- All other errors: Unchanged behavior

### Error Precedence

1. Existing validation errors (InvalidAmount, AgentNotRegistered, etc.)
2. IdempotencyConflict (if key exists with different hash)
3. Execution errors (Overflow, token transfer failures, etc.)

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests** focus on:
- Specific examples of idempotent retries
- Edge cases (expired records, maximum key length)
- Error conditions (conflict detection, invalid keys)
- Integration with existing transfer logic

**Property Tests** focus on:
- Hash determinism across all inputs
- Idempotency guarantees for all valid requests
- Expiration behavior for all TTL values
- Backward compatibility for all non-idempotent requests

### Property-Based Testing Configuration

- **Library**: proptest (Rust property-based testing framework)
- **Iterations**: Minimum 100 per property test
- **Tag format**: `// Feature: idempotency-protection, Property {number}: {property_text}`

### Test Coverage

Each correctness property (1-12) MUST be implemented as a property-based test:

1. **Property 1 (Hash Determinism)**: Generate random request parameters, compute hash twice, assert equality
2. **Property 2 (Hash Sensitivity)**: Generate pairs of different requests, assert different hashes
3. **Property 3 (Hash Input Completeness)**: Generate request, mutate each field, assert hash changes
4. **Property 4 (Idempotent Retry)**: Generate request, execute twice with same key, assert same remittance_id
5. **Property 5 (No Side Effects)**: Generate request, execute twice, assert counter increments only once
6. **Property 6 (Conflict Detection)**: Generate request, execute with same key but different payload, assert error
7. **Property 7 (Expired Keys)**: Generate request, advance time past TTL, execute again, assert new execution
8. **Property 8 (Expiration Calculation)**: Generate request, check stored expires_at equals current_time + TTL
9. **Property 9 (Backward Compatibility)**: Generate requests without keys, assert normal execution
10. **Property 10 (Key Acceptance)**: Generate various valid keys, assert acceptance
11. **Property 11 (Successful Storage)**: Generate request, execute successfully, assert record exists
12. **Property 12 (Failed No Storage)**: Generate invalid request with key, assert no record stored

### Unit Test Examples

- Test retry with exact same parameters returns same remittance_id
- Test retry after expiration creates new remittance
- Test conflict with different amount returns error
- Test request without key doesn't create idempotency record
- Test maximum key length (255 characters) works
- Test key with special characters (hyphens, underscores) works

## Implementation Notes

### Minimal Modifications

The implementation should:
- Add `idempotency_key: Option<String>` parameter to `create_remittance`
- Add idempotency check logic at the start of `create_remittance` (after validation)
- Add idempotency record storage at the end of `create_remittance` (after success)
- Add new storage functions in `storage.rs` (no modifications to existing functions)
- Add new error variant in `errors.rs` (no modifications to existing errors)
- Use existing `hashing` module for hash computation

### Storage Considerations

- Use persistent storage for idempotency records (long-term retention)
- Use instance storage for TTL configuration (contract-level setting)
- Records are indexed by idempotency key (String)
- No automatic cleanup of expired records (lazy deletion on access)

### Performance Considerations

- Idempotency check adds one storage read per request with key
- Hash computation is O(1) with fixed-size inputs
- No impact on requests without idempotency keys
- Storage growth is bounded by TTL (automatic expiration)
