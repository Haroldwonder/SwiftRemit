# Settlement ID Implementation

## Overview

Each settlement has a unique, sequential identifier for traceability and auditing. Settlement IDs are the same as remittance IDs since settlements are the completion of remittances.

## Implementation

### ID Generation

Settlement IDs are generated incrementally using a counter:

```rust
// Counter starts at 0, first remittance gets ID 1
let counter = get_remittance_counter(&env)?;
let remittance_id = counter.checked_add(1)?;
set_remittance_counter(&env, remittance_id);
```

### ID Storage

IDs are stored in the `Remittance` struct:

```rust
pub struct Remittance {
    pub id: u64,              // Unique settlement ID
    pub sender: Address,
    pub agent: Address,
    pub amount: i128,
    pub fee: i128,
    pub status: RemittanceStatus,
    pub expiry: Option<u64>,
}
```

### ID Return

The `confirm_payout` function now returns the settlement ID:

```rust
pub fn confirm_payout(env: Env, remittance_id: u64) -> Result<u64, ContractError>
```

**Before:**
```rust
contract.confirm_payout(&remittance_id)?; // Returns ()
```

**After:**
```rust
let settlement_id = contract.confirm_payout(&remittance_id)?; // Returns ID
```

## Querying Settlements

Use the settlement ID to query settlement data:

```rust
// Query by settlement ID
let settlement = contract.get_settlement(&settlement_id)?;

println!("Settlement ID: {}", settlement.id);
println!("Status: {:?}", settlement.status);
println!("Amount: {}", settlement.amount);
println!("Fee: {}", settlement.fee);
```

## Properties

### ✅ Unique

Each settlement ID is unique across the entire contract:

```rust
let id1 = contract.create_remittance(&sender1, &agent, &1000, &None); // ID: 1
let id2 = contract.create_remittance(&sender2, &agent, &2000, &None); // ID: 2
let id3 = contract.create_remittance(&sender1, &agent, &3000, &None); // ID: 3

// All IDs are different
assert_ne!(id1, id2);
assert_ne!(id1, id3);
assert_ne!(id2, id3);
```

### ✅ Sequential

IDs are generated in sequential order:

```rust
let id1 = contract.create_remittance(...); // 1
let id2 = contract.create_remittance(...); // 2
let id3 = contract.create_remittance(...); // 3

assert_eq!(id1, 1);
assert_eq!(id2, 2);
assert_eq!(id3, 3);
```

### ✅ Persistent

Settlement IDs remain the same throughout the lifecycle:

```rust
let remittance_id = contract.create_remittance(...);  // ID: 5
let settlement_id = contract.confirm_payout(&remittance_id)?; // Returns: 5

assert_eq!(remittance_id, settlement_id);

let settlement = contract.get_settlement(&settlement_id)?;
assert_eq!(settlement.id, 5); // Still 5
```

## Usage Examples

### Basic Settlement Flow

```rust
// 1. Create remittance (generates ID)
let remittance_id = contract.create_remittance(
    &sender,
    &agent,
    &10000,
    &None
)?;
println!("Created remittance with ID: {}", remittance_id);

// 2. Confirm payout (returns settlement ID)
let settlement_id = contract.confirm_payout(&remittance_id)?;
println!("Settlement completed with ID: {}", settlement_id);

// 3. Query settlement data
let settlement = contract.get_settlement(&settlement_id)?;
println!("Settlement status: {:?}", settlement.status);
```

### Audit Trail

```rust
// Track all settlements for auditing
let mut settlement_ids = vec![];

for remittance_id in pending_remittances {
    let settlement_id = contract.confirm_payout(&remittance_id)?;
    settlement_ids.push(settlement_id);
}

// Later, audit all settlements
for id in settlement_ids {
    let settlement = contract.get_settlement(&id)?;
    audit_log.record(settlement);
}
```

### Batch Processing

```rust
// Process multiple settlements and track IDs
let results: Vec<(u64, Result<u64, ContractError>)> = remittance_ids
    .iter()
    .map(|id| (*id, contract.confirm_payout(id)))
    .collect();

// Report results
for (remittance_id, result) in results {
    match result {
        Ok(settlement_id) => {
            println!("✅ Remittance {} settled as {}", remittance_id, settlement_id);
        }
        Err(e) => {
            println!("❌ Remittance {} failed: {:?}", remittance_id, e);
        }
    }
}
```

## API Changes

### `confirm_payout` Return Type

**Old:**
```rust
pub fn confirm_payout(env: Env, remittance_id: u64) -> Result<(), ContractError>
```

**New:**
```rust
pub fn confirm_payout(env: Env, remittance_id: u64) -> Result<u64, ContractError>
```

### Migration Guide

If you have existing code:

```rust
// Before
contract.confirm_payout(&remittance_id)?;
do_something();

// After - just capture the ID
let settlement_id = contract.confirm_payout(&remittance_id)?;
do_something();
```

## Test Coverage

### 3 Comprehensive Tests

1. **`test_settlement_id_returned`**
   - Verifies ID is returned from confirm_payout
   - Confirms ID can be used to query settlement

2. **`test_settlement_ids_sequential`**
   - Verifies IDs are generated sequentially (1, 2, 3...)
   - Confirms settlement IDs match remittance IDs

3. **`test_settlement_id_uniqueness`**
   - Verifies all IDs are unique
   - Tests across multiple senders and agents

## Benefits

### For Auditing
- Track every settlement with unique ID
- Query historical settlements
- Build audit trails

### For Monitoring
- Monitor settlement completion by ID
- Track settlement metrics
- Identify specific settlements in logs

### For Integration
- Return settlement ID to users
- Store IDs in external databases
- Link settlements to external systems

## Acceptance Criteria

✅ **IDs are unique and sequential**
- Counter-based generation ensures uniqueness
- Sequential increment (1, 2, 3...)
- No ID collisions

✅ **Can query settlement using the ID**
- `get_settlement(id)` returns settlement data
- ID persists throughout lifecycle
- Works for all settlement states

✅ **Generate incremental settlement IDs**
- Counter starts at 0
- Each remittance gets next ID
- Overflow protected

✅ **Store ID alongside settlement data**
- ID stored in Remittance struct
- Persisted in contract storage
- Accessible via queries

✅ **Return ID after execution**
- `confirm_payout` returns settlement ID
- ID matches original remittance ID
- Can be used immediately for queries

---

**Status:** ✅ IMPLEMENTED

**Note:** Settlement IDs are identical to remittance IDs since settlements are completed remittances. This provides a unified identifier throughout the remittance lifecycle.
