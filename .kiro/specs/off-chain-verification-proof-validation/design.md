# Design Document: Off-Chain Verification Proof Validation

## Overview

This design implements cryptographic proof validation for oracle-confirmed settlement flows in SwiftRemit. The system enables agents to submit signed proofs of off-chain payout completion, which the contract validates before executing on-chain settlements.

**Key Principles:**
- Backward compatible: Existing settlements without proof validation continue to work
- Flexible: Proof validation is optional per settlement
- Secure: Uses Stellar-compatible Ed25519 signatures
- Deterministic: Proof validation is reproducible and auditable

## Architecture

### High-Level Flow

```
Agent calls confirm_payout with optional proof
         |
         v
Check if settlement requires proof
         |
    +----+----+
    |         |
  Yes        No
    |         |
    v         v
Verify proof  Execute settlement
    |         (existing flow)
    v
Valid?
    |
+---+---+
|       |
Yes    No
|       |
v       v
Execute Reject
settlement error
```

### Component Interaction

1. **ProofData** (new): Encapsulates signed proof from oracle/agent
2. **SettlementConfig** (new): Configures proof requirements per settlement
3. **verify_proof()** (new): Validates Ed25519 signatures
4. **confirm_payout()** (modified): Checks proof before settlement
5. **Remittance** (modified): Stores settlement configuration

## Data Models

### ProofData Structure

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProofData {
    /// Ed25519 signature (64 bytes)
    pub signature: BytesN<64>,
    
    /// Signed payload containing settlement details
    pub payload: Bytes,
    
    /// Address of the signer (oracle or agent)
    pub signer: Address,
}
```

**Payload Format (JSON):**
```json
{
  "remittance_id": 123,
  "amount": 1000000000,
  "recipient": "GXXXXXX...",
  "timestamp": 1234567890,
  "status": "completed"
}
```

### SettlementConfig Structure

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementConfig {
    /// Whether proof validation is required for this settlement
    pub require_proof: bool,
    
    /// Oracle/signer address for proof validation
    /// Required if require_proof is true
    pub oracle_address: Option<Address>,
}
```

### Updated Remittance Structure

```rust
pub struct Remittance {
    pub id: u64,
    pub sender: Address,
    pub agent: Address,
    pub amount: i128,
    pub fee: i128,
    pub status: RemittanceStatus,
    pub expiry: Option<u64>,
    pub settlement_config: Option<SettlementConfig>,  // NEW
}
```

## Function Signatures

### verify_proof()

```rust
/// Verify a cryptographic proof using Ed25519 signature validation.
///
/// # Arguments
/// * `env` - Soroban environment
/// * `proof` - ProofData containing signature, payload, and signer
/// * `expected_signer` - Expected signer address for validation
///
/// # Returns
/// * `Ok(true)` - Signature is valid
/// * `Ok(false)` - Signature is invalid
/// * `Err(ContractError)` - Validation error
pub fn verify_proof(
    env: &Env,
    proof: &ProofData,
    expected_signer: &Address,
) -> Result<bool, ContractError>
```

**Implementation:**
1. Extract public key from expected_signer address
2. Use `env.crypto().ed25519_verify()` to validate signature
3. Return validation result

### Modified create_remittance()

```rust
pub fn create_remittance(
    env: Env,
    sender: Address,
    agent: Address,
    amount: i128,
    expiry: Option<u64>,
    idempotency_key: Option<String>,
    settlement_config: Option<SettlementConfig>,  // NEW
) -> Result<u64, ContractError>
```

**Validation:**
- If `settlement_config.require_proof` is true, `oracle_address` must be Some
- Store settlement_config in remittance record

### Modified confirm_payout()

```rust
pub fn confirm_payout(
    env: Env,
    remittance_id: u64,
    proof: Option<ProofData>,  // NEW
) -> Result<(), ContractError>
```

**Logic:**
1. Retrieve remittance
2. Check if settlement_config.require_proof is true
3. If required and proof is None: return MissingProof error
4. If required and proof is Some: call verify_proof()
5. If proof invalid: return InvalidProof error
6. If proof valid or not required: execute settlement (existing logic)

## Error Types

Add to `errors.rs`:

```rust
#[contracterror]
pub enum ContractError {
    // ... existing errors ...
    
    /// Proof validation failed.
    /// Cause: Signature is invalid or signer doesn't match expected oracle.
    InvalidProof = 50,
    
    /// Proof is required but not provided.
    /// Cause: Settlement requires proof validation but proof parameter is None.
    MissingProof = 51,
    
    /// Oracle address is invalid or not configured.
    /// Cause: Settlement requires proof but oracle_address is None.
    InvalidOracleAddress = 52,
}
```

## Storage

### New Storage Keys

Add to `storage.rs` DataKey enum:

```rust
enum DataKey {
    // ... existing keys ...
    
    /// Settlement configuration indexed by remittance ID (persistent storage)
    SettlementConfig(u64),
}
```

### Storage Functions

```rust
/// Get settlement configuration for a remittance
pub fn get_settlement_config(
    env: &Env,
    remittance_id: u64,
) -> Option<SettlementConfig>

/// Set settlement configuration for a remittance
pub fn set_settlement_config(
    env: &Env,
    remittance_id: u64,
    config: &SettlementConfig,
)
```

## Correctness Properties

### Property 1: Valid Proof Acceptance
*For any* valid Ed25519 signature from the expected oracle, `verify_proof()` SHALL return `Ok(true)`.
**Validates:** Proof validation works correctly for valid signatures.

### Property 2: Invalid Proof Rejection
*For any* invalid Ed25519 signature, `verify_proof()` SHALL return `Ok(false)`.
**Validates:** Invalid signatures are rejected.

### Property 3: Wrong Signer Rejection
*For any* valid signature from a different signer, `verify_proof()` SHALL return `Ok(false)`.
**Validates:** Signatures from wrong signers are rejected.

### Property 4: Proof Required Enforcement
*For any* settlement with `require_proof=true`, calling `confirm_payout()` without proof SHALL return `MissingProof` error.
**Validates:** Proof requirement is enforced.

### Property 5: Proof Validation Before Settlement
*For any* settlement with `require_proof=true` and invalid proof, `confirm_payout()` SHALL return `InvalidProof` error without executing settlement.
**Validates:** Invalid proofs prevent settlement execution.

### Property 6: Backward Compatibility
*For any* settlement without proof requirement, `confirm_payout()` SHALL execute using existing agent authorization flow.
**Validates:** Existing settlements continue to work.

### Property 7: Oracle Address Validation
*For any* settlement with `require_proof=true` but `oracle_address=None`, `create_remittance()` SHALL return `InvalidOracleAddress` error.
**Validates:** Configuration is validated.

### Property 8: Proof Immutability
*For any* settlement, the stored settlement_config SHALL NOT change after creation.
**Validates:** Configuration cannot be modified after settlement creation.

## Testing Strategy

### Unit Tests (verification.rs)

1. **test_verify_proof_valid_signature** - Valid signature from correct signer
2. **test_verify_proof_invalid_signature** - Invalid signature
3. **test_verify_proof_wrong_signer** - Valid signature from wrong signer
4. **test_verify_proof_empty_payload** - Edge case with empty payload
5. **test_verify_proof_tampered_payload** - Payload modified after signing

### Integration Tests (test.rs)

1. **test_settlement_with_valid_proof** - Full flow with valid proof
2. **test_settlement_with_invalid_proof** - Invalid proof rejection
3. **test_settlement_missing_required_proof** - Missing proof error
4. **test_settlement_without_proof_requirement** - Existing flow unchanged
5. **test_settlement_config_validation** - Configuration validation
6. **test_backward_compatibility** - Old settlements work unchanged
7. **test_proof_with_expired_settlement** - Proof validation with expiry
8. **test_proof_with_cancelled_settlement** - Proof validation with cancelled status
9. **test_proof_with_completed_settlement** - Proof validation with completed status
10. **test_proof_replay_protection** - Same proof cannot be used twice

## Implementation Notes

### Minimal Modifications

The implementation should:
- Add ProofData and SettlementConfig types to types.rs
- Add verify_proof() function to new verification.rs module
- Add settlement_config field to Remittance struct
- Modify create_remittance() to accept and store settlement_config
- Modify confirm_payout() to validate proof if required
- Add new storage functions for settlement_config
- Add new error types
- Maintain backward compatibility

### Signature Validation

Uses Stellar SDK's Ed25519 verification:
```rust
env.crypto().ed25519_verify(
    &public_key,
    &message,
    &signature
)
```

### Replay Protection

Proof validation is tied to specific remittance_id and settlement, preventing replay across different settlements.

## Deployment Considerations

### Migration

Existing settlements without settlement_config continue to work:
- settlement_config is Option<SettlementConfig>
- None means no proof validation required
- Existing code paths unchanged

### Monitoring

Track:
- Proof validation success rate
- Invalid proof rejections
- Missing proof errors
- Settlement completion time with/without proof

### Rollback

If issues found:
1. Pause contract
2. Investigate proof validation failures
3. Deploy fix or revert to previous version
4. Resume operations

## Security Considerations

### Signature Validation

- Uses Stellar-compatible Ed25519
- Timing-safe comparison (handled by SDK)
- No custom cryptography

### Replay Protection

- Proof tied to specific remittance_id
- Payload includes timestamp
- Cannot be reused for different settlements

### Oracle Trust

- Oracle address must be configured correctly
- Proof validation only as strong as oracle security
- Recommend multi-sig oracle setup

## Future Enhancements

1. **Multiple Signers** - Require signatures from multiple oracles
2. **Proof Expiry** - Proofs expire after certain time
3. **Proof Versioning** - Support different proof formats
4. **Batch Proof Validation** - Validate multiple proofs in one transaction
5. **Proof Storage** - Store proofs on-chain for audit trail

---

**Status:** Ready for implementation  
**Priority:** High  
**Complexity:** Medium  
**Estimated Effort:** 2-3 days
