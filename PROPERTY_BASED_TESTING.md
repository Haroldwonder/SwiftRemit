# Property-Based Testing for Fee Calculations

This document describes the comprehensive property-based testing suite for SwiftRemit's fee calculation logic, designed to catch edge cases, overflows, and mathematical inconsistencies through fuzzing.

## Overview

Property-based testing uses randomly generated inputs to verify that mathematical properties hold across a wide range of scenarios. Unlike traditional unit tests that check specific cases, property tests verify invariants that should always be true.

## Test Coverage

### TypeScript Tests (`backend/src/__tests__/fee-calculation-property.test.ts`)

Uses **fast-check** library with 1000+ test cases per property.

#### Core Properties Tested

1. **Fee Bounds**
   - Fees never exceed the original amount
   - Fees are always at least `MIN_FEE` (1 stroop)
   - Maximum fee (100% bps) equals the amount

2. **Monotonic Behavior**
   - Fees increase monotonically with fee basis points
   - Fees increase monotonically with amount (when not floored)

3. **Mathematical Consistency**
   - `amount = platformFee + protocolFee + netAmount`
   - Net amount is never negative
   - Fee breakdown validation

4. **Dynamic Fee Tiers**
   - Tier 1 (< 1000 USDC): Full fee rate
   - Tier 2 (1000-10000 USDC): 80% of base rate
   - Tier 3 (> 10000 USDC): 60% of base rate
   - Proper tier boundary handling

5. **Edge Cases**
   - Zero fee basis points → MIN_FEE
   - Maximum safe integer handling
   - Boundary value testing
   - Invalid input rejection

### Rust Tests (`src/fee_service_property_tests.rs`)

Uses **proptest** library with 1000+ test cases per property.

#### Core Properties Tested

1. **Fee Calculation Properties**
   ```rust
   // Fee never exceeds amount
   prop_assert!(fee <= amount);
   
   // Fee is at least minimum
   prop_assert!(fee >= MIN_FEE);
   
   // Exact formula verification
   let expected = (amount * fee_bps as i128 / FEE_DIVISOR).max(MIN_FEE);
   prop_assert_eq!(calculated_fee, expected);
   ```

2. **Overflow Protection**
   ```rust
   // Large values should either succeed or return overflow error
   match calculate_fee_by_strategy(large_amount, &strategy) {
       Ok(fee) => { /* verify fee is valid */ }
       Err(ContractError::Overflow) => { /* acceptable */ }
       Err(other) => prop_assert!(false, "Unexpected error: {:?}", other)
   }
   ```

3. **Dynamic Fee Tier Verification**
   ```rust
   // Verify tier discounts are applied correctly
   let tier1_fee = calculate_fee_by_strategy(500_0000000, &strategy)?;
   let tier2_fee = calculate_fee_by_strategy(5000_0000000, &strategy)?;
   let tier3_fee = calculate_fee_by_strategy(20000_0000000, &strategy)?;
   
   // Verify tier ordering for normalized amounts
   prop_assert!(norm_tier1 >= norm_tier2 >= norm_tier3);
   ```

## Running the Tests

### TypeScript Property Tests
```bash
# Standard testing (1000 cases per property)
cd backend
npm test -- fee-calculation-property.test.ts

# Quick validation (100 cases)
cd backend
npm test -- fee-calculation-property.test.ts --reporter=verbose
```

### Rust Property Tests
```bash
# Quick validation (10 test cases)
PROPTEST_CASES=10 cargo test fee_service_property_tests --lib -- --nocapture

# Standard fuzzing (100 test cases per property - default)
cargo test fee_service_property_tests --lib -- --nocapture

# Intensive fuzzing (1000+ test cases)
PROPTEST_CASES=1000 cargo test fee_service_property_tests --lib -- --nocapture

# Run specific test
cargo test prop_percentage_fee_never_negative --lib -- --nocapture

# Verbose output (shows generated values)
PROPTEST_VERBOSE=1 cargo test fee_service_property_tests --lib -- --nocapture
```

### Comprehensive Test Runner
```bash
# Run all property-based tests
./run-property-tests.sh
```

## Key Test Strategies

### Input Generation

```typescript
// TypeScript generators
fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER })  // Valid amounts
fc.integer({ min: 0, max: 10000 })                   // Valid basis points
fc.integer({ min: 100, max: 1000000 })               // Reasonable amounts
```

```rust
// Rust generators
prop_compose! {
    fn valid_amount()(amount in 1i128..=i128::MAX/MAX_FEE_BPS as i128) -> i128 {
        amount
    }
}
```

### Overflow Testing

Both test suites include specific tests for overflow conditions:

- Large amounts near `i128::MAX` / `Number.MAX_SAFE_INTEGER`
- High fee basis points that could cause multiplication overflow
- Boundary conditions where `amount * fee_bps` approaches limits

### Boundary Testing

Special focus on tier boundaries for dynamic fees:

```rust
let boundary1 = 1000_0000000i128;  // Tier 1/2 boundary
let boundary2 = 10000_0000000i128; // Tier 2/3 boundary

// Test just below and at boundaries
let just_below = boundary1 - 1;
let fee_below = calculate_fee_by_strategy(just_below, &strategy)?;
let fee_at = calculate_fee_by_strategy(boundary1, &strategy)?;
```

## Test Configuration

### Fast-Check Configuration

```typescript
fc.assert(
  fc.property(/* generators */, (/* params */) => {
    // Property assertions
  }),
  { numRuns: 1000 }  // Run 1000 random test cases
);
```

### Proptest Configuration

```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(1000))]
    
    #[test]
    fn property_name(/* generators */) {
        // Property assertions
    }
}
```

## Benefits of Property-Based Testing

1. **Comprehensive Coverage**: Tests thousands of input combinations automatically
2. **Edge Case Discovery**: Finds corner cases that manual testing might miss
3. **Regression Prevention**: Catches regressions across the entire input space
4. **Mathematical Verification**: Ensures fee calculations maintain mathematical properties
5. **Overflow Protection**: Verifies safe arithmetic operations
6. **Confidence**: Provides high confidence in fee calculation correctness

## Common Properties Verified

### Universal Properties

- **Non-negativity**: All fees and amounts are non-negative
- **Bounds checking**: Fees don't exceed reasonable limits
- **Monotonicity**: Increasing inputs produce non-decreasing outputs
- **Consistency**: Mathematical relationships are preserved

### Fee-Specific Properties

- **Minimum floor**: All fees respect the minimum fee requirement
- **Percentage accuracy**: Percentage calculations are mathematically correct
- **Tier behavior**: Dynamic tiers apply correct discounts
- **Breakdown consistency**: Fee components sum to the total amount

## Interpreting Test Results

### Success Indicators

- All property assertions pass across 1000+ test cases
- No unexpected errors or panics
- Consistent behavior across input ranges

### Failure Analysis

When a property test fails:

1. **Shrinking**: The framework automatically finds the minimal failing case
2. **Reproduction**: Failed cases can be reproduced with specific seeds
3. **Root Cause**: Examine the specific input values that caused failure
4. **Fix Verification**: Re-run tests to verify fixes

## Integration with CI/CD

These property tests should be integrated into the continuous integration pipeline:

```yaml
# Example CI configuration
- name: Run Property-Based Tests
  run: |
    cd backend && npm test -- fee-calculation-property.test.ts
    PROPTEST_CASES=500 cargo test fee_service_property_tests --lib -- --nocapture --test-threads=1
```

For nightly/stress testing:
```yaml
- name: Intensive fee fuzzing
  if: github.event_name == 'schedule'
  run: |
    PROPTEST_CASES=5000 cargo test fee_service_property_tests --lib -- --nocapture
```

## Performance Benchmarks

Expected runtimes (approximate):
- **TypeScript (1000 cases)**: ~30-60 seconds
- **Rust (10 cases)**: ~2-3 seconds
- **Rust (100 cases)**: ~20-30 seconds
- **Rust (500 cases)**: 2-3 minutes
- **Rust (1000 cases)**: 4-5 minutes

Times vary based on system performance and compilation cache.

## Manual Fee Calculation for Verification

The test suite includes helper functions to verify calculations:

```typescript
// TypeScript
function calculateExpectedFee(amount: number, bps: number): number {
  return Math.max(MIN_FEE, Math.floor((amount * bps) / 10000));
}
```

```rust
// Rust
fn manual_percentage_fee(amount: i128, bps: u32) -> Option<i128> {
    let product = (amount as i128).checked_mul(bps as i128)?;
    let fee = product.checked_div(FEE_DIVISOR)?;
    Some(fee.max(MIN_FEE))
}
```

**Formula**: `fee = max(MIN_FEE, (amount × bps) / 10000)`

## Future Enhancements

1. **Cross-Language Verification**: Compare TypeScript and Rust implementations
2. **Performance Properties**: Verify computational complexity bounds
3. **Stateful Testing**: Test sequences of fee calculations
4. **Integration Properties**: Test fee calculations in full transaction flows
5. **Metamorphic Testing**: Verify relationships between different fee strategies
6. **Corridor-specific fee validation**
7. **Volume discount validation**
8. **Multi-token fee calculations**

This comprehensive property-based testing approach provides strong assurance that the fee calculation logic is mathematically sound, handles edge cases correctly, and protects against overflows and other arithmetic errors.
