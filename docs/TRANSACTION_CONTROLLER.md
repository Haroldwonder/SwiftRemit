# Transaction Controller Service

## Overview

The Transaction Controller is a centralized service that orchestrates the complete transaction flow for SwiftRemit. It provides a robust, fault-tolerant system for processing remittances with built-in validation, KYC checks, rollback handling, and retry logic.

## Architecture

### Transaction Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   Transaction Controller                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. Validate User Eligibility                                │
│     ├─ Check blacklist status                                │
│     └─ Verify user permissions                               │
│                                                               │
│  2. Confirm KYC Approval                                     │
│     ├─ Check KYC approval status                             │
│     └─ Verify KYC expiry                                     │
│                                                               │
│  3. Call Soroban Contract                                    │
│     ├─ Validate amount and agent                             │
│     ├─ Transfer tokens to escrow                             │
│     └─ Create remittance record                              │
│                                                               │
│  4. Initiate Anchor Operation                                │
│     ├─ Generate anchor transaction ID                        │
│     └─ Store anchor mapping                                  │
│                                                               │
│  5. Store Transaction Record                                 │
│     └─ Save audit trail                                      │
│                                                               │
│  ✓ Transaction Complete                                      │
│                                                               │
│  [On Failure: Automatic Rollback]                            │
│     ├─ Cancel anchor operation                               │
│     ├─ Refund tokens                                         │
│     └─ Update transaction state                              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Features

### 1. User Eligibility Validation
- Blacklist checking
- Permission verification
- Balance validation (via token contract)

### 2. KYC Approval Confirmation
- KYC status verification
- Expiry date checking
- Compliance enforcement

### 3. Soroban Contract Integration
- Remittance creation
- Token escrow management
- Fee calculation and collection

### 4. Anchor Operations
- Withdrawal/deposit initiation
- Transaction ID generation
- Anchor mapping management

### 5. Transaction Record Storage
- Complete audit trail
- State tracking
- Retry count monitoring

### 6. Error Handling
- Automatic rollback on failure
- Partial failure recovery
- Transaction state management

### 7. Retry Logic
- Configurable retry attempts (default: 3)
- Retry delay (default: 5 seconds)
- Transient error detection
- Non-retryable error handling

## API Functions

### Core Transaction Functions

#### `execute_transaction`
Execute a complete transaction with all validations and checks.

```rust
pub fn execute_transaction(
    env: Env,
    user: Address,
    agent: Address,
    amount: i128,
    expiry: Option<u64>,
) -> Result<TransactionRecord, ContractError>
```

**Parameters:**
- `user`: User initiating the transaction
- `agent`: Agent receiving the payout
- `amount`: Transaction amount in USDC
- `expiry`: Optional expiry timestamp

**Returns:** `TransactionRecord` with complete transaction details

**Errors:**
- `UserBlacklisted` (14) - User is blacklisted
- `KycNotApproved` (15) - User KYC not approved
- `KycExpired` (16) - User KYC has expired
- `InvalidAmount` (3) - Amount is zero or negative
- `AgentNotRegistered` (5) - Agent not registered
- `Overflow` (8) - Arithmetic overflow

**Example:**
```rust
let record = contract.execute_transaction(
    &user,
    &agent,
    &1000,
    &Some(expiry_time)
)?;
```

#### `get_transaction_status`
Get the current status and details of a transaction.

```rust
pub fn get_transaction_status(
    env: Env,
    remittance_id: u64,
) -> Result<TransactionRecord, ContractError>
```

**Parameters:**
- `remittance_id`: ID of the remittance to query

**Returns:** `TransactionRecord` with current state

**Errors:**
- `TransactionNotFound` (17) - Transaction record not found

**Example:**
```rust
let status = contract.get_transaction_status(&remittance_id)?;
```

#### `retry_transaction`
Retry a failed transaction.

```rust
pub fn retry_transaction(
    env: Env,
    remittance_id: u64,
) -> Result<TransactionRecord, ContractError>
```

**Parameters:**
- `remittance_id`: ID of the failed transaction

**Returns:** `TransactionRecord` with updated state

**Errors:**
- `InvalidStatus` (7) - Transaction not in failed state
- `TransactionNotFound` (17) - Transaction record not found

**Example:**
```rust
let record = contract.retry_transaction(&remittance_id)?;
```

### User Management Functions

#### `set_user_blacklisted`
Set user blacklist status (admin only).

```rust
pub fn set_user_blacklisted(
    env: Env,
    user: Address,
    blacklisted: bool
) -> Result<(), ContractError>
```

**Parameters:**
- `user`: User address
- `blacklisted`: Blacklist status

**Example:**
```rust
contract.set_user_blacklisted(&user, &true)?;
```

#### `is_user_blacklisted`
Check if user is blacklisted.

```rust
pub fn is_user_blacklisted(env: Env, user: Address) -> bool
```

**Example:**
```rust
if contract.is_user_blacklisted(&user) {
    // User is blacklisted
}
```

#### `set_kyc_approved`
Set user KYC approval status (admin only).

```rust
pub fn set_kyc_approved(
    env: Env,
    user: Address,
    approved: bool,
    expiry: u64
) -> Result<(), ContractError>
```

**Parameters:**
- `user`: User address
- `approved`: KYC approval status
- `expiry`: KYC expiry timestamp

**Example:**
```rust
let expiry = env.ledger().timestamp() + (365 * 24 * 60 * 60); // 1 year
contract.set_kyc_approved(&user, &true, &expiry)?;
```

#### `is_kyc_approved`
Check if user KYC is approved and not expired.

```rust
pub fn is_kyc_approved(env: Env, user: Address) -> bool
```

**Example:**
```rust
if contract.is_kyc_approved(&user) {
    // User KYC is valid
}
```

## Transaction States

### State Transitions

```
Initial
  ↓
EligibilityValidated
  ↓
KycConfirmed
  ↓
ContractCalled { remittance_id }
  ↓
AnchorInitiated { anchor_tx_id }
  ↓
RecordStored
  ↓
Completed

[On Failure] → RolledBack
```

### State Descriptions

| State | Description |
|-------|-------------|
| `Initial` | Transaction created, no operations performed |
| `EligibilityValidated` | User eligibility checks passed |
| `KycConfirmed` | KYC verification completed |
| `ContractCalled` | Soroban contract called, remittance created |
| `AnchorInitiated` | Anchor operation initiated |
| `RecordStored` | Transaction record saved |
| `Completed` | Transaction successfully completed |
| `RolledBack` | Transaction failed and rolled back |

## Transaction Record

```rust
pub struct TransactionRecord {
    pub user: Address,
    pub agent: Address,
    pub amount: i128,
    pub remittance_id: Option<u64>,
    pub anchor_tx_id: Option<u64>,
    pub state: TransactionState,
    pub retry_count: u32,
    pub timestamp: u64,
}
```

## Error Handling

### Rollback Behavior

The transaction controller automatically rolls back on failure:

1. **AnchorInitiated/RecordStored State**
   - Cancel anchor operation
   - Refund tokens to user
   - Update remittance status to Cancelled

2. **ContractCalled State**
   - Refund tokens to user
   - Update remittance status to Cancelled

3. **Earlier States**
   - No rollback needed (no state changes made)

### Retry Logic

**Retryable Errors:**
- `Overflow` - Arithmetic overflow (transient)
- `NotInitialized` - Initialization issue (transient)

**Non-Retryable Errors:**
- `UserBlacklisted` - User is blacklisted
- `KycNotApproved` - KYC not approved
- `KycExpired` - KYC expired
- `InvalidAmount` - Invalid amount
- `AgentNotRegistered` - Agent not registered

**Retry Configuration:**
- Maximum attempts: 3
- Retry delay: 5 seconds
- Exponential backoff: Not implemented (fixed delay)

## Usage Examples

### Complete Transaction Flow

```rust
// 1. Admin sets up user KYC
let expiry = env.ledger().timestamp() + (365 * 24 * 60 * 60);
contract.set_kyc_approved(&user, &true, &expiry)?;

// 2. Execute transaction
let record = contract.execute_transaction(
    &user,
    &agent,
    &1000,
    &None
)?;

// 3. Check transaction status
let status = contract.get_transaction_status(&record.remittance_id.unwrap())?;
assert_eq!(status.state, TransactionState::Completed);
```

### Handling Failed Transactions

```rust
// Execute transaction (may fail)
match contract.execute_transaction(&user, &agent, &1000, &None) {
    Ok(record) => {
        // Transaction successful
        log!("Transaction completed: {:?}", record.remittance_id);
    }
    Err(e) => {
        // Transaction failed and rolled back
        log!("Transaction failed: {:?}", e);
        
        // Optionally retry if appropriate
        if is_retryable(&e) {
            let record = contract.retry_transaction(&remittance_id)?;
        }
    }
}
```

### Blacklist Management

```rust
// Blacklist a user
contract.set_user_blacklisted(&suspicious_user, &true)?;

// Check blacklist status
if contract.is_user_blacklisted(&user) {
    return Err(ContractError::UserBlacklisted);
}

// Remove from blacklist
contract.set_user_blacklisted(&user, &false)?;
```

## Security Considerations

1. **Admin-Only Functions**
   - `set_user_blacklisted` requires admin authentication
   - `set_kyc_approved` requires admin authentication

2. **KYC Enforcement**
   - All transactions require valid KYC
   - KYC expiry is automatically checked
   - Expired KYC blocks transactions

3. **Blacklist Enforcement**
   - Blacklisted users cannot initiate transactions
   - Checked before any state changes

4. **Atomic Operations**
   - Token transfers are atomic
   - Rollback ensures consistency
   - No partial state on failure

5. **Audit Trail**
   - All transactions are recorded
   - State transitions are tracked
   - Retry attempts are logged

## Integration Guide

### For Frontend Applications

```javascript
// Execute transaction
const result = await contract.execute_transaction({
  user: userAddress,
  agent: agentAddress,
  amount: 1000n,
  expiry: null
});

// Check status
const status = await contract.get_transaction_status({
  remittance_id: result.remittance_id
});

// Retry if needed
if (status.state === 'RolledBack') {
  const retryResult = await contract.retry_transaction({
    remittance_id: result.remittance_id
  });
}
```

### For Backend Services

```rust
// Set up user
let kyc_expiry = current_time + ONE_YEAR;
contract.set_kyc_approved(&user, &true, &kyc_expiry)?;

// Process transaction
let record = contract.execute_transaction(
    &user,
    &agent,
    &amount,
    &expiry
)?;

// Store in database
database.save_transaction(&record)?;

// Monitor status
let status = contract.get_transaction_status(&record.remittance_id.unwrap())?;
```

## Performance Considerations

1. **Storage Efficiency**
   - Transaction records use persistent storage
   - Anchor mappings are indexed for fast lookup
   - KYC data is cached per user

2. **Gas Optimization**
   - Validation checks are ordered by cost (cheapest first)
   - Early returns on validation failures
   - Minimal storage writes

3. **Retry Strategy**
   - Fixed retry count prevents infinite loops
   - Delay between retries reduces load
   - Non-retryable errors fail fast

## Monitoring and Observability

### Key Metrics to Track

1. **Transaction Success Rate**
   - Completed vs Failed transactions
   - Rollback frequency

2. **Retry Statistics**
   - Average retry count
   - Retry success rate

3. **Validation Failures**
   - Blacklist rejections
   - KYC failures
   - Eligibility issues

4. **State Distribution**
   - Transactions per state
   - Average time in each state

### Events Emitted

The transaction controller leverages existing events:
- `remittance_created` - When contract is called
- `remittance_cancelled` - On rollback
- `remittance_completed` - On successful completion

## Troubleshooting

### Common Issues

**Issue: Transaction fails with `KycNotApproved`**
- Solution: Admin must approve user KYC first

**Issue: Transaction fails with `UserBlacklisted`**
- Solution: Admin must remove user from blacklist

**Issue: Transaction fails with `KycExpired`**
- Solution: Admin must renew user KYC with new expiry

**Issue: Retry fails with `InvalidStatus`**
- Solution: Only rolled-back transactions can be retried

## Future Enhancements

1. **Async Anchor Integration**
   - Real anchor API integration
   - Webhook support for status updates

2. **Advanced Retry Logic**
   - Exponential backoff
   - Configurable retry policies
   - Circuit breaker pattern

3. **Enhanced Monitoring**
   - Detailed event emissions
   - Performance metrics
   - Health checks

4. **Batch Processing**
   - Multiple transaction execution
   - Bulk KYC updates
   - Batch blacklist management

---

**Version**: 1.0.0  
**Last Updated**: 2026-02-20  
**Status**: Production Ready
