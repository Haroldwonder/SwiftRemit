# Net Settlement Implementation

## Overview

This document describes the net settlement logic implementation for SwiftRemit, which offsets opposing transfers between the same two parties so only the net difference is executed on-chain.

## Problem Statement

In a remittance system, multiple transfers can occur between the same parties in opposite directions. Without netting:
- If A transfers 100 to B and B transfers 90 to A, two separate on-chain transfers occur
- This results in unnecessary gas costs and blockchain congestion
- Total transfer volume: 190 units

With net settlement:
- Only the net difference (10 from A to B) is executed on-chain
- Reduces gas costs and improves efficiency
- Total transfer volume: 10 units (95% reduction)

## Implementation Architecture

### Core Components

#### 1. Netting Module (`src/netting.rs`)

The netting module provides deterministic, order-independent net settlement calculations:

**Key Functions:**
- `compute_net_settlements()`: Computes net balances between all party pairs
- `validate_net_settlement()`: Verifies mathematical correctness and fee preservation
- `normalize_pair()`: Ensures deterministic address ordering
- `compare_addresses()`: Lexicographic address comparison

**Data Structures:**
- `NetTransfer`: Represents a net transfer after offsetting
  - `party_a`: Lexicographically smaller address
  - `party_b`: Lexicographically larger address
  - `net_amount`: Net amount (positive = A→B, negative = B→A)
  - `total_fees`: Accumulated fees from all netted remittances

#### 2. Batch Settlement Function (`src/lib.rs`)

**Function:** `batch_settle_with_netting()`

Processes multiple remittances in a single transaction with net settlement optimization.

**Parameters:**
- `entries: Vec<BatchSettlementEntry>`: List of remittance IDs to settle

**Returns:**
- `BatchSettlementResult`: Contains list of successfully settled remittance IDs

**Process Flow:**
1. Validate batch size (1-50 remittances)
2. Load and validate all remittances
3. Check for duplicates, expiry, and status
4. Compute net settlements using netting algorithm
5. Validate mathematical correctness
6. Execute minimal set of net transfers
7. Accumulate all fees
8. Mark all remittances as completed
9. Emit events for monitoring

## Algorithm Properties

### 1. Deterministic

The algorithm produces identical results for the same input, regardless of:
- Order of remittances in the batch
- Time of execution
- Previous state

This is achieved through:
- Lexicographic address ordering
- Consistent aggregation logic
- No random or time-dependent operations

### 2. Order-Independent

Processing remittances in any order yields the same net result:

```
Batch 1: [A→B: 100, B→A: 90] = Net: A→B: 10
Batch 2: [B→A: 90, A→B: 100] = Net: A→B: 10
```

### 3. Fair

All participants receive correct amounts:
- Fees are preserved exactly (no rounding errors)
- Net amounts are mathematically correct
- No party gains or loses from netting

### 4. Consistent

The implementation maintains accounting integrity:
- Total fees in = Total fees out
- All remittances marked as completed
- Settlement hashes prevent duplicates
- Events emitted for all operations

## Mathematical Correctness

### Fee Preservation

```
Original Remittances:
- R1: A→B: 100 (fee: 2.5)
- R2: B→A: 90 (fee: 2.25)

Net Settlement:
- Net Transfer: A→B: 10
- Total Fees: 4.75 (2.5 + 2.25)

Verification:
✓ All fees preserved
✓ Net amount correct (100 - 90 = 10)
✓ No rounding errors
```

### Validation Function

The `validate_net_settlement()` function verifies:
1. Total fees are preserved exactly
2. No arithmetic overflow
3. All calculations are consistent

## Security Features

### 1. Duplicate Prevention

- Checks for duplicate remittance IDs in batch
- Uses settlement hashes to prevent double execution
- Validates remittance status before processing

### 2. Authorization

- All remittances require proper authorization
- Agent addresses validated before transfers
- Admin-only pause mechanism

### 3. Overflow Protection

- All arithmetic operations use checked math
- Returns `ContractError::Overflow` on overflow
- Safe i128 operations throughout

### 4. Expiry Checks

- Validates settlement expiry timestamps
- Prevents settlement of expired remittances
- Returns `ContractError::SettlementExpired` when expired

### 5. Pause Mechanism

- Contract can be paused by admin
- All settlements blocked when paused
- Returns `ContractError::ContractPaused` when paused

## Usage Examples

### Example 1: Simple Offset

```rust
// Create opposing remittances
let id1 = contract.create_remittance(&alice, &bob, &100, &None);
let id2 = contract.create_remittance(&bob, &alice, &90, &None);

// Batch settle with netting
let mut entries = Vec::new(&env);
entries.push_back(BatchSettlementEntry { remittance_id: id1 });
entries.push_back(BatchSettlementEntry { remittance_id: id2 });

let result = contract.batch_settle_with_netting(&entries);
// Result: Single transfer of 10 from Alice to Bob
```

### Example 2: Complete Offset

```rust
// Create equal opposing remittances
let id1 = contract.create_remittance(&alice, &bob, &100, &None);
let id2 = contract.create_remittance(&bob, &alice, &100, &None);

let mut entries = Vec::new(&env);
entries.push_back(BatchSettlementEntry { remittance_id: id1 });
entries.push_back(BatchSettlementEntry { remittance_id: id2 });

let result = contract.batch_settle_with_netting(&entries);
// Result: No net transfer (complete offset), but fees still collected
```

### Example 3: Multiple Parties

```rust
// Create triangle of remittances
let id1 = contract.create_remittance(&alice, &bob, &100, &None);
let id2 = contract.create_remittance(&bob, &charlie, &50, &None);
let id3 = contract.create_remittance(&charlie, &alice, &30, &None);

let mut entries = Vec::new(&env);
entries.push_back(BatchSettlementEntry { remittance_id: id1 });
entries.push_back(BatchSettlementEntry { remittance_id: id2 });
entries.push_back(BatchSettlementEntry { remittance_id: id3 });

let result = contract.batch_settle_with_netting(&entries);
// Result: Three net transfers (one per pair)
// A→B: 100, B→C: 50, C→A: 30
```

## Performance Benefits

### Transfer Reduction

| Scenario | Without Netting | With Netting | Reduction |
|----------|----------------|--------------|-----------|
| 2 opposing transfers (100, 90) | 2 transfers | 1 transfer | 50% |
| 2 equal opposing transfers (100, 100) | 2 transfers | 0 transfers | 100% |
| 10 alternating transfers | 10 transfers | 1-2 transfers | 80-90% |
| 50 mixed transfers | 50 transfers | 5-25 transfers | 50-90% |

### Gas Savings

- Each avoided transfer saves ~10,000-50,000 gas units
- Batch processing reduces overhead
- Single transaction for multiple settlements

## Testing

### Unit Tests

The implementation includes comprehensive unit tests:

1. **Basic Functionality**
   - `test_net_settlement_simple_offset`: Basic A→B, B→A offset
   - `test_net_settlement_complete_offset`: Equal opposing transfers
   - `test_net_settlement_multiple_parties`: Triangle of transfers

2. **Mathematical Correctness**
   - `test_net_settlement_fee_preservation`: Verifies all fees preserved
   - `test_net_settlement_mathematical_correctness`: Complex multi-transfer validation
   - `test_net_settlement_order_independence`: Same result regardless of order

3. **Edge Cases**
   - `test_net_settlement_empty_batch`: Empty batch rejection
   - `test_net_settlement_exceeds_max_batch_size`: Batch size limit
   - `test_net_settlement_duplicate_ids`: Duplicate detection

4. **Error Conditions**
   - `test_net_settlement_already_completed`: Prevents double settlement
   - `test_net_settlement_when_paused`: Respects pause state
   - `test_net_settlement_reduces_transfer_count`: Verifies optimization

5. **Performance**
   - `test_net_settlement_large_batch`: Maximum batch size (50)
   - Stress tests for various scenarios

### Running Tests

```bash
# Run all tests
cargo test

# Run only net settlement tests
cargo test net_settlement

# Run with output
cargo test -- --nocapture
```

## Error Handling

| Error Code | Error | Description |
|------------|-------|-------------|
| 3 | InvalidAmount | Empty batch or exceeds MAX_BATCH_SIZE |
| 6 | RemittanceNotFound | Remittance ID doesn't exist |
| 7 | InvalidStatus | Remittance not in Pending status |
| 8 | Overflow | Arithmetic overflow in calculations |
| 10 | InvalidAddress | Address validation failed |
| 11 | SettlementExpired | Settlement window expired |
| 12 | DuplicateSettlement | Duplicate ID or already settled |
| 13 | ContractPaused | Contract is paused |

## Events

The implementation emits comprehensive events for monitoring:

### Settlement Events

```rust
emit_settlement_completed(
    env,
    sender: Address,
    recipient: Address,
    token: Address,
    amount: i128
)
```

### Remittance Events

```rust
emit_remittance_completed(
    env,
    remittance_id: u64,
    sender: Address,
    agent: Address,
    token: Address,
    amount: i128
)
```

## Integration Guide

### 1. Client Integration

```javascript
// JavaScript/TypeScript example
const entries = [
  { remittance_id: 1n },
  { remittance_id: 2n },
  { remittance_id: 3n }
];

const result = await contract.batch_settle_with_netting({
  entries: entries
});

console.log(`Settled ${result.settled_ids.length} remittances`);
```

### 2. Monitoring

Monitor events to track net settlements:
- `settle.complete`: Net transfer executed
- `remit.complete`: Individual remittance completed

### 3. Best Practices

1. **Batch Size**: Use 10-30 remittances per batch for optimal gas efficiency
2. **Party Grouping**: Group remittances by party pairs for maximum netting benefit
3. **Timing**: Batch settlements during low-traffic periods
4. **Monitoring**: Track netting efficiency metrics

## Backwards Compatibility

The net settlement implementation is fully backwards compatible:

- Existing `confirm_payout()` function unchanged
- New `batch_settle_with_netting()` is additive
- No breaking changes to storage or types
- All existing tests pass

## Future Enhancements

Potential improvements for future versions:

1. **Multi-Token Netting**: Support netting across different tokens
2. **Time-Weighted Netting**: Prioritize older remittances
3. **Partial Settlement**: Allow partial batch settlement on errors
4. **Netting Analytics**: Track netting efficiency metrics
5. **Automated Batching**: Automatic batch creation based on criteria

## Conclusion

The net settlement implementation provides:

✅ Deterministic, order-independent calculations
✅ Mathematical correctness with fee preservation
✅ Comprehensive security and validation
✅ Significant gas savings (50-90% reduction)
✅ Full backwards compatibility
✅ Extensive test coverage
✅ Production-ready code

The implementation reduces on-chain transfer volume while maintaining complete accounting integrity and security.
