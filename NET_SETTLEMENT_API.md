# Net Settlement API Reference

## Overview

This document provides detailed API reference for the net settlement functionality in SwiftRemit.

## Public Functions

### batch_settle_with_netting

Batch settle multiple remittances with net settlement optimization.

```rust
pub fn batch_settle_with_netting(
    env: Env,
    entries: Vec<BatchSettlementEntry>,
) -> Result<BatchSettlementResult, ContractError>
```

#### Description

Processes multiple remittances in a single transaction and applies net settlement logic to offset opposing transfers between the same parties. Only the net difference is executed on-chain, reducing total token transfers.

#### Parameters

- `env: Env` - Soroban environment
- `entries: Vec<BatchSettlementEntry>` - Vector of remittance IDs to settle

#### Returns

- `Ok(BatchSettlementResult)` - Contains list of successfully settled remittance IDs
- `Err(ContractError)` - Error if validation or execution fails

#### Errors

| Error | Code | Condition |
|-------|------|-----------|
| `ContractPaused` | 13 | Contract is in paused state |
| `InvalidAmount` | 3 | Batch is empty or exceeds MAX_BATCH_SIZE (50) |
| `RemittanceNotFound` | 6 | One or more remittance IDs don't exist |
| `InvalidStatus` | 7 | One or more remittances not in Pending status |
| `DuplicateSettlement` | 12 | Duplicate remittance IDs in batch or already settled |
| `SettlementExpired` | 11 | One or more remittances have expired |
| `InvalidAddress` | 10 | Agent address validation failed |
| `Overflow` | 8 | Arithmetic overflow in calculations |

#### Authorization

- Requires authorization from each remittance's agent
- Contract must not be paused
- All remittances must be in Pending status

#### Events Emitted

For each net transfer:
```rust
emit_settlement_completed(
    sender: Address,
    recipient: Address,
    token: Address,
    amount: i128
)
```

For each remittance:
```rust
emit_remittance_completed(
    remittance_id: u64,
    sender: Address,
    agent: Address,
    token: Address,
    amount: i128
)
```

#### Example Usage

```rust
use soroban_sdk::{Env, Vec};

// Create batch entries
let mut entries = Vec::new(&env);
entries.push_back(BatchSettlementEntry { remittance_id: 1 });
entries.push_back(BatchSettlementEntry { remittance_id: 2 });
entries.push_back(BatchSettlementEntry { remittance_id: 3 });

// Execute batch settlement
let result = contract.batch_settle_with_netting(&entries)?;

// Check results
assert_eq!(result.settled_ids.len(), 3);
```

#### Gas Considerations

- Base cost: ~50,000 gas units
- Per remittance: ~10,000 gas units
- Per net transfer: ~30,000 gas units
- Netting reduces transfer count, saving gas

#### Best Practices

1. **Batch Size**: Use 10-30 remittances for optimal efficiency
2. **Party Grouping**: Group remittances between same parties for maximum netting
3. **Error Handling**: Check all remittances are valid before batching
4. **Monitoring**: Track settled_ids to verify completion

## Data Types

### BatchSettlementEntry

Entry for batch settlement processing.

```rust
#[contracttype]
pub struct BatchSettlementEntry {
    pub remittance_id: u64,
}
```

#### Fields

- `remittance_id: u64` - The unique ID of the remittance to settle

#### Example

```rust
let entry = BatchSettlementEntry {
    remittance_id: 42,
};
```

### BatchSettlementResult

Result of a batch settlement operation.

```rust
#[contracttype]
pub struct BatchSettlementResult {
    pub settled_ids: Vec<u64>,
}
```

#### Fields

- `settled_ids: Vec<u64>` - List of successfully settled remittance IDs

#### Example

```rust
let result = BatchSettlementResult {
    settled_ids: vec![1, 2, 3],
};
```

### NetTransfer

Represents a net transfer between two parties after offsetting (internal use).

```rust
pub struct NetTransfer {
    pub party_a: Address,
    pub party_b: Address,
    pub net_amount: i128,
    pub total_fees: i128,
}
```

#### Fields

- `party_a: Address` - Party with lexicographically smaller address
- `party_b: Address` - Party with lexicographically larger address
- `net_amount: i128` - Net amount (positive = A→B, negative = B→A)
- `total_fees: i128` - Accumulated fees from all netted remittances

## Constants

### MAX_BATCH_SIZE

Maximum number of settlements that can be processed in a single batch.

```rust
pub const MAX_BATCH_SIZE: u32 = 50;
```

This limit prevents excessive resource consumption in a single transaction.

## Internal Functions

These functions are used internally by the netting algorithm but are not exposed as contract functions.

### compute_net_settlements

Computes net settlements by offsetting opposing transfers.

```rust
pub fn compute_net_settlements(
    remittances: &Vec<Remittance>
) -> Vec<NetTransfer>
```

#### Algorithm

1. Extract all directional flows from remittances
2. Group flows by party pairs (order-independent)
3. Calculate net balances for each pair
4. Return minimal set of net transfers

#### Properties

- **Deterministic**: Same input always produces same output
- **Order-independent**: Processing order doesn't affect result
- **Fair**: All fees preserved, no rounding errors
- **Efficient**: O(n) time complexity

### validate_net_settlement

Validates that net settlement calculations are mathematically correct.

```rust
pub fn validate_net_settlement(
    original_remittances: &Vec<Remittance>,
    net_transfers: &Vec<NetTransfer>,
) -> Result<(), ContractError>
```

#### Validation Checks

1. Total fees are preserved exactly
2. No arithmetic overflow
3. All calculations are consistent

#### Returns

- `Ok(())` if validation passes
- `Err(ContractError::Overflow)` if validation fails

### normalize_pair

Normalizes a pair of addresses to ensure deterministic ordering.

```rust
fn normalize_pair(
    from: &Address,
    to: &Address
) -> (Address, Address, i128)
```

#### Returns

- `(party_a, party_b, direction)` where:
  - `party_a`: Lexicographically smaller address
  - `party_b`: Lexicographically larger address
  - `direction`: 1 if from < to, -1 otherwise

### compare_addresses

Compares two addresses lexicographically.

```rust
fn compare_addresses(a: &Address, b: &Address) -> i32
```

#### Returns

- `-1` if a < b
- `0` if a == b
- `1` if a > b

## Integration Examples

### JavaScript/TypeScript

```typescript
import { Contract, SorobanRpc } from '@stellar/stellar-sdk';

// Initialize contract
const contract = new Contract(contractId);

// Prepare batch entries
const entries = [
  { remittance_id: 1n },
  { remittance_id: 2n },
  { remittance_id: 3n }
];

// Build transaction
const tx = await contract.batch_settle_with_netting({
  entries: entries
});

// Submit and wait for result
const result = await tx.signAndSend();
console.log(`Settled: ${result.settled_ids.length} remittances`);
```

### Python

```python
from stellar_sdk import SorobanServer, TransactionBuilder

# Initialize contract
contract = Contract(contract_id)

# Prepare batch entries
entries = [
    {"remittance_id": 1},
    {"remittance_id": 2},
    {"remittance_id": 3}
]

# Invoke contract
result = contract.batch_settle_with_netting(entries=entries)
print(f"Settled: {len(result['settled_ids'])} remittances")
```

### Rust (Contract-to-Contract)

```rust
use soroban_sdk::{contract, contractimpl, Address, Env, Vec};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn settle_batch(
        env: Env,
        swiftremit: Address,
        ids: Vec<u64>
    ) -> Result<(), Error> {
        // Create entries
        let mut entries = Vec::new(&env);
        for i in 0..ids.len() {
            let id = ids.get_unchecked(i);
            entries.push_back(BatchSettlementEntry {
                remittance_id: id
            });
        }
        
        // Call SwiftRemit contract
        let client = SwiftRemitContractClient::new(&env, &swiftremit);
        let result = client.batch_settle_with_netting(&entries)?;
        
        Ok(())
    }
}
```

## Event Monitoring

### Listen for Settlement Events

```typescript
// Subscribe to settlement events
const stream = server.getEvents({
  contractIds: [contractId],
  topics: [['settle', 'complete']],
  startLedger: currentLedger
});

stream.on('message', (event) => {
  const [
    schema_version,
    sequence,
    timestamp,
    sender,
    recipient,
    token,
    amount
  ] = event.value;
  
  console.log(`Net transfer: ${sender} → ${recipient}: ${amount}`);
});
```

### Listen for Remittance Completion

```typescript
// Subscribe to remittance completion events
const stream = server.getEvents({
  contractIds: [contractId],
  topics: [['remit', 'complete']],
  startLedger: currentLedger
});

stream.on('message', (event) => {
  const [
    schema_version,
    sequence,
    timestamp,
    remittance_id,
    sender,
    agent,
    token,
    amount
  ] = event.value;
  
  console.log(`Remittance ${remittance_id} completed`);
});
```

## Performance Metrics

### Netting Efficiency

Calculate netting efficiency:

```typescript
function calculateNettingEfficiency(
  originalCount: number,
  netTransferCount: number
): number {
  return ((originalCount - netTransferCount) / originalCount) * 100;
}

// Example: 10 remittances → 2 net transfers
const efficiency = calculateNettingEfficiency(10, 2);
console.log(`Netting efficiency: ${efficiency}%`); // 80%
```

### Gas Savings

Estimate gas savings:

```typescript
function estimateGasSavings(
  originalCount: number,
  netTransferCount: number,
  gasPerTransfer: number = 30000
): number {
  const savedTransfers = originalCount - netTransferCount;
  return savedTransfers * gasPerTransfer;
}

// Example: 10 remittances → 2 net transfers
const savings = estimateGasSavings(10, 2);
console.log(`Gas saved: ${savings} units`); // 240,000
```

## Testing

### Unit Test Example

```rust
#[test]
fn test_batch_settlement() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Setup
    let contract = create_contract(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    
    // Create remittances
    let id1 = contract.create_remittance(&alice, &bob, &100, &None);
    let id2 = contract.create_remittance(&bob, &alice, &90, &None);
    
    // Batch settle
    let mut entries = Vec::new(&env);
    entries.push_back(BatchSettlementEntry { remittance_id: id1 });
    entries.push_back(BatchSettlementEntry { remittance_id: id2 });
    
    let result = contract.batch_settle_with_netting(&entries);
    
    // Verify
    assert!(result.is_ok());
    assert_eq!(result.unwrap().settled_ids.len(), 2);
}
```

## Security Considerations

### 1. Authorization

All remittances in the batch must have proper authorization from their respective agents.

### 2. Duplicate Prevention

The function checks for:
- Duplicate IDs within the batch
- Already settled remittances (via settlement hash)

### 3. Expiry Validation

All remittances are checked for expiry before settlement.

### 4. Overflow Protection

All arithmetic operations use checked math to prevent overflow.

### 5. Pause Mechanism

Contract can be paused to halt all settlements in emergency situations.

## Troubleshooting

### Common Issues

#### Error: InvalidAmount (Code 3)

**Cause**: Batch is empty or exceeds MAX_BATCH_SIZE

**Solution**: Ensure batch has 1-50 entries

```typescript
if (entries.length === 0 || entries.length > 50) {
  throw new Error('Invalid batch size');
}
```

#### Error: DuplicateSettlement (Code 12)

**Cause**: Duplicate remittance IDs in batch or already settled

**Solution**: Remove duplicates and check settlement status

```typescript
const uniqueIds = [...new Set(entries.map(e => e.remittance_id))];
const entries = uniqueIds.map(id => ({ remittance_id: id }));
```

#### Error: InvalidStatus (Code 7)

**Cause**: One or more remittances not in Pending status

**Solution**: Filter for pending remittances only

```typescript
const pending = await Promise.all(
  ids.map(async id => {
    const rem = await contract.get_remittance({ remittance_id: id });
    return rem.status === 'Pending' ? id : null;
  })
);
const validIds = pending.filter(id => id !== null);
```

## Changelog

### Version 1.0.0

- Initial implementation of net settlement
- `batch_settle_with_netting()` function
- `BatchSettlementEntry` and `BatchSettlementResult` types
- Comprehensive validation and error handling
- Event emission for monitoring
- Full test coverage

## Support

For issues and questions:
- GitHub Issues: [Create an issue](https://github.com/yourusername/swiftremit/issues)
- Documentation: See [NET_SETTLEMENT.md](NET_SETTLEMENT.md)
- API Reference: This document
