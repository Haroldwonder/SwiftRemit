# Net Settlement for SwiftRemit

## 🎯 What is Net Settlement?

Net settlement is an optimization that offsets opposing transfers between the same two parties, executing only the net difference on-chain. This dramatically reduces transaction costs and blockchain congestion.

### Example

**Without Net Settlement:**
```
Transaction 1: Alice → Bob: 100 USDC
Transaction 2: Bob → Alice: 90 USDC
Total on-chain transfers: 2
Total volume: 190 USDC
```

**With Net Settlement:**
```
Net Transaction: Alice → Bob: 10 USDC
Total on-chain transfers: 1
Total volume: 10 USDC
Savings: 50% fewer transfers, 95% less volume
```

## 🚀 Quick Start

### Basic Usage

```rust
use soroban_sdk::{Env, Vec};

// Create batch of remittances to settle
let mut entries = Vec::new(&env);
entries.push_back(BatchSettlementEntry { remittance_id: 1 });
entries.push_back(BatchSettlementEntry { remittance_id: 2 });

// Execute batch settlement with automatic netting
let result = contract.batch_settle_with_netting(&entries)?;

// Check results
println!("Settled {} remittances", result.settled_ids.len());
```

### JavaScript/TypeScript

```javascript
const entries = [
  { remittance_id: 1n },
  { remittance_id: 2n }
];

const result = await contract.batch_settle_with_netting({ entries });
console.log(`Settled: ${result.settled_ids.length} remittances`);
```

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [NET_SETTLEMENT.md](NET_SETTLEMENT.md) | Complete implementation guide with algorithm details |
| [NET_SETTLEMENT_API.md](NET_SETTLEMENT_API.md) | Detailed API reference and integration examples |
| [NET_SETTLEMENT_QUICKREF.md](NET_SETTLEMENT_QUICKREF.md) | Quick reference card for developers |
| [NET_SETTLEMENT_SUMMARY.md](NET_SETTLEMENT_SUMMARY.md) | Executive summary and implementation overview |
| [NET_SETTLEMENT_CHECKLIST.md](NET_SETTLEMENT_CHECKLIST.md) | Deployment and verification checklist |
| [examples/net-settlement-example.js](examples/net-settlement-example.js) | Working code examples |

## ✨ Key Features

### 🎲 Deterministic
Same input always produces the same output, regardless of processing order or timing.

### 🔄 Order-Independent
Remittances can be processed in any order with identical results.

### 💰 Fee-Preserving
All fees are collected exactly as calculated - no rounding errors.

### 🔒 Secure
- Duplicate prevention
- Overflow protection
- Authorization checks
- Expiry validation
- Pause mechanism

### ⚡ Efficient
- 50-100% reduction in on-chain transfers
- O(n) algorithm complexity
- Batch processing (1-50 remittances)
- Significant gas savings

### 🔙 Backwards Compatible
- No breaking changes
- All existing functions work unchanged
- Additive functionality only

## 📊 Performance Benefits

| Scenario | Transfers Before | Transfers After | Savings |
|----------|-----------------|-----------------|---------|
| Simple offset (100 vs 90) | 2 | 1 | 50% |
| Complete offset (100 vs 100) | 2 | 0 | 100% |
| 10 alternating transfers | 10 | 1-2 | 80-90% |
| 50 mixed transfers | 50 | 5-25 | 50-90% |

### Gas Savings Example

```
Without netting:
10 remittances × 50,000 gas = 500,000 gas

With netting (2 net transfers):
Batch overhead: 50,000 gas
2 transfers × 30,000 gas = 60,000 gas
Total: 110,000 gas

Savings: 390,000 gas (78%)
```

## 🏗️ Architecture

### Core Components

1. **Netting Module** (`src/netting.rs`)
   - Deterministic netting algorithm
   - Mathematical validation
   - Address normalization

2. **Batch Settlement** (`src/lib.rs`)
   - Public contract function
   - Validation and error handling
   - Net transfer execution

3. **Data Types** (`src/types.rs`)
   - BatchSettlementEntry
   - BatchSettlementResult
   - MAX_BATCH_SIZE constant

### Algorithm Flow

```
1. Load remittances → 2. Validate → 3. Compute nets → 4. Validate math
                                                              ↓
8. Mark complete ← 7. Emit events ← 6. Accumulate fees ← 5. Execute transfers
```

## 🧪 Testing

### Run Tests

```bash
# All tests
cargo test

# Net settlement tests only
cargo test net_settlement

# Specific test
cargo test test_net_settlement_simple_offset

# With output
cargo test -- --nocapture
```

### Test Coverage

- ✅ 20+ comprehensive unit tests
- ✅ Basic functionality (offset, complete offset, multiple parties)
- ✅ Mathematical correctness (fee preservation, order independence)
- ✅ Edge cases (empty batch, oversized batch, duplicates)
- ✅ Error conditions (paused, expired, invalid status)
- ✅ Performance (large batches, transfer reduction)

## 🔐 Security

### Protections

- **Duplicate Prevention**: Checks for duplicate IDs and settlement hashes
- **Overflow Protection**: All arithmetic uses checked operations
- **Authorization**: Requires proper authorization for all operations
- **Expiry Validation**: Checks settlement expiry timestamps
- **Fee Integrity**: Validates fee preservation mathematically
- **Pause Mechanism**: Emergency stop capability

### Error Codes

| Code | Error | Description |
|------|-------|-------------|
| 3 | InvalidAmount | Empty batch or exceeds MAX_BATCH_SIZE |
| 6 | RemittanceNotFound | Remittance ID doesn't exist |
| 7 | InvalidStatus | Remittance not in Pending status |
| 8 | Overflow | Arithmetic overflow detected |
| 12 | DuplicateSettlement | Duplicate ID or already settled |
| 13 | ContractPaused | Contract is paused |

## 📖 Examples

### Example 1: Simple Offset

```rust
// Alice sends 100 to Bob
let id1 = contract.create_remittance(&alice, &bob, &100, &None);

// Bob sends 90 to Alice
let id2 = contract.create_remittance(&bob, &alice, &90, &None);

// Batch settle with netting
let mut entries = Vec::new(&env);
entries.push_back(BatchSettlementEntry { remittance_id: id1 });
entries.push_back(BatchSettlementEntry { remittance_id: id2 });

let result = contract.batch_settle_with_netting(&entries)?;
// Result: Single net transfer of 10 from Alice to Bob
```

### Example 2: Complete Offset

```rust
// Equal opposing transfers
let id1 = contract.create_remittance(&alice, &bob, &100, &None);
let id2 = contract.create_remittance(&bob, &alice, &100, &None);

let mut entries = Vec::new(&env);
entries.push_back(BatchSettlementEntry { remittance_id: id1 });
entries.push_back(BatchSettlementEntry { remittance_id: id2 });

let result = contract.batch_settle_with_netting(&entries)?;
// Result: No net transfer (complete offset), but fees still collected
```

### Example 3: JavaScript Integration

```javascript
// Create remittances
const id1 = await contract.create_remittance({
  sender: alice,
  agent: bob,
  amount: 100n,
  expiry: null
});

const id2 = await contract.create_remittance({
  sender: bob,
  agent: alice,
  amount: 90n,
  expiry: null
});

// Batch settle
const entries = [
  { remittance_id: id1 },
  { remittance_id: id2 }
];

const result = await contract.batch_settle_with_netting({ entries });
console.log(`Settled ${result.settled_ids.length} remittances`);
```

## 🎯 Best Practices

1. **Batch Size**: Use 10-30 remittances for optimal gas efficiency
2. **Party Grouping**: Group remittances between same parties for maximum netting
3. **Validation**: Check all remittances are valid before batching
4. **Monitoring**: Track events to verify settlements
5. **Error Handling**: Handle all error codes appropriately

## 📈 Monitoring

### Events to Track

```rust
// Net settlement completed
emit_settlement_completed(sender, recipient, token, amount)

// Individual remittance completed
emit_remittance_completed(id, sender, agent, token, amount)
```

### Metrics to Monitor

- Number of batch settlements
- Average batch size
- Netting efficiency (%)
- Gas savings per batch
- Error rate
- Fee collection accuracy

## 🚦 Getting Started

### 1. Read the Documentation

Start with [NET_SETTLEMENT.md](NET_SETTLEMENT.md) for a comprehensive overview.

### 2. Review the API

Check [NET_SETTLEMENT_API.md](NET_SETTLEMENT_API.md) for detailed API reference.

### 3. Try the Examples

Run the examples in [examples/net-settlement-example.js](examples/net-settlement-example.js).

### 4. Integrate

Use the [Quick Reference](NET_SETTLEMENT_QUICKREF.md) for integration.

### 5. Deploy

Follow the [Deployment Checklist](NET_SETTLEMENT_CHECKLIST.md).

## 🔧 Troubleshooting

### Common Issues

**Error: InvalidAmount (Code 3)**
- Check batch size is between 1-50
- Ensure entries array is not empty

**Error: DuplicateSettlement (Code 12)**
- Remove duplicate IDs from batch
- Check remittances haven't been settled already

**Error: InvalidStatus (Code 7)**
- Verify all remittances are in Pending status
- Don't include completed or cancelled remittances

**Error: ContractPaused (Code 13)**
- Wait for contract to be unpaused
- Contact admin if pause is unexpected

## 📦 What's Included

### Source Code
- `src/netting.rs` - Core netting algorithm (450+ lines)
- `src/lib.rs` - Batch settlement function (150+ lines)
- `src/types.rs` - Data type definitions
- `src/test.rs` - Comprehensive tests (600+ lines)

### Documentation
- Implementation guide (2000+ lines)
- API reference (1500+ lines)
- Quick reference card
- Summary document
- Deployment checklist
- This README

### Examples
- JavaScript/TypeScript examples
- Rust integration examples
- Python examples
- Monitoring examples

## 🎓 Learn More

### Algorithm Details

The netting algorithm uses:
- Lexicographic address ordering for determinism
- Commutative aggregation for order independence
- Checked arithmetic for overflow protection
- Mathematical validation for correctness

### Mathematical Properties

- **Conservation**: Total fees in = Total fees out
- **Correctness**: Net flow matches sum of directional flows
- **Determinism**: Same input → Same output
- **Fairness**: No party gains or loses from netting

## 🤝 Contributing

Contributions welcome! Please ensure:
- All tests pass: `cargo test`
- Code is formatted: `cargo fmt`
- No warnings: `cargo clippy`
- Documentation is updated
- Examples are provided

## 📄 License

Same as SwiftRemit main project (MIT).

## 🆘 Support

- **Documentation**: See files listed above
- **Examples**: Check `examples/` directory
- **Issues**: Create GitHub issue
- **Questions**: See main README

## 🎉 Summary

Net settlement for SwiftRemit provides:

✅ **50-100% reduction** in on-chain transfers
✅ **Deterministic** and order-independent calculations
✅ **Mathematical correctness** with fee preservation
✅ **Comprehensive security** with multiple protections
✅ **Full backwards compatibility** with existing code
✅ **Production-ready** with extensive testing
✅ **Well-documented** with examples and guides

Start using net settlement today to optimize your remittance operations!

---

**Version**: 1.0.0  
**Status**: Production Ready ✅  
**Last Updated**: 2026-02-20
