# Property-Based Tests for State Machine Invariants

## Overview

This document describes the property-based tests added to `src/test_transitions.rs` to verify state machine transition invariants across arbitrary sequences of operations.

## Motivation

While unit tests verify specific scenarios, property-based tests use randomized input generation to discover edge cases and verify that invariants hold universally. This approach is particularly valuable for state machines where the number of possible transition sequences grows exponentially.

## Test Framework

Tests use **proptest** (v1.4), a Rust property-based testing framework that:
- Generates arbitrary test inputs according to defined strategies
- Shrinks failing cases to minimal reproducers
- Provides deterministic replay via seed values

## Invariants Tested

### 1. Terminal States Are Immutable
**Invariant**: `Completed` and `Cancelled` states cannot transition to any other state.

```rust
prop_terminal_states_are_immutable
```

**Why it matters**: Ensures finality — once a remittance is settled or cancelled, its state is locked.

### 2. Valid Transitions Are Allowed
**Invariant**: All transitions in the state machine graph are explicitly allowed by `can_transition_to()`.

```rust
prop_valid_transitions_allowed
```

**Valid transitions**:
- `Pending` → `Processing`, `Cancelled`, `Failed`
- `Processing` → `Completed`, `Cancelled`, `Failed`
- `Failed` → `Disputed`
- Any state → itself (idempotent)

### 3. Invalid Transitions Are Rejected
**Invariant**: Transitions not in the state machine graph are explicitly rejected.

```rust
prop_invalid_transitions_rejected
```

**Examples of invalid transitions**:
- `Pending` → `Completed` (must go through `Processing`)
- `Completed` → `Pending` (terminal state cannot transition)
- `Processing` → `Pending` (no backward transitions)

### 4. Idempotent Transitions Are Safe
**Invariant**: Transitioning to the same state is always allowed (safe for retries).

```rust
prop_idempotent_transitions_allowed
```

**Why it matters**: Enables safe retry logic without state corruption.

### 5. Terminal States Block Further Transitions
**Invariant**: If a valid transition leads to a terminal state, that terminal state cannot transition further.

```rust
prop_terminal_states_block_further_transitions
```

**Why it matters**: Prevents accidental state corruption after settlement.

### 6. State Graph Is Acyclic
**Invariant**: No cycles exist in the state machine (except self-loops).

```rust
prop_no_cycles_in_state_graph
```

**Why it matters**: Ensures deterministic progression toward terminal states; prevents infinite loops.

### 7. Disputed State Reachability
**Invariant**: `Disputed` state can only be reached from `Failed` state.

```rust
prop_disputed_only_from_failed
```

**Why it matters**: Enforces the dispute resolution workflow — disputes only arise from failed payouts.

### 8. Pending Is Initial-Only
**Invariant**: `Pending` is the only initial state; no other state transitions to `Pending`.

```rust
prop_pending_is_initial_only
```

**Why it matters**: Prevents accidental re-initialization of settled remittances.

### 9. Non-Terminal States Have Exits
**Invariant**: Every non-terminal state has at least one valid outgoing transition.

```rust
prop_non_terminal_states_have_exits
```

**Why it matters**: Ensures no "stuck" states where remittances cannot progress.

### 10. Transition Validation Is Deterministic
**Invariant**: Calling `can_transition_to()` multiple times with the same inputs always returns the same result.

```rust
prop_transition_validation_is_deterministic
```

**Why it matters**: Ensures predictable, reproducible behavior for contract operations.

## Test Strategies

### `arb_status()`
Generates arbitrary `RemittanceStatus` values:
- `Pending`, `Processing`, `Completed`, `Cancelled`, `Failed`, `Disputed`

### `arb_valid_transition()`
Generates valid (from, to) transition pairs:
- All edges in the state machine graph
- Idempotent transitions (same state)

### `arb_invalid_transition()`
Generates invalid (from, to) transition pairs:
- Terminal state transitions
- Invalid forward transitions
- Backward transitions

## Deterministic Tests

In addition to property-based tests, two deterministic tests verify:

### `test_state_machine_graph_coverage()`
Explicitly verifies all expected transitions exist:
```
Pending → Processing, Cancelled, Failed
Processing → Completed, Cancelled, Failed
Failed → Disputed
```

### `test_terminal_states_comprehensive()`
Verifies that `Completed` and `Cancelled` cannot transition to any other state.

## Running the Tests

```bash
# Run all transition tests
cargo test --lib test_transitions

# Run only property-based tests
cargo test --lib test_transitions prop_

# Run with verbose output
cargo test --lib test_transitions -- --nocapture

# Run with custom seed for reproducibility
PROPTEST_REGRESSIONS=src/test_transitions.rs cargo test --lib test_transitions
```

## Failure Reproduction

If a property test fails, proptest automatically:
1. Shrinks the failing case to a minimal reproducer
2. Saves the seed to `proptest/regressions/src_test_transitions_rs.txt`
3. Replays the same seed on subsequent runs

To replay a specific failure:
```bash
PROPTEST_REGRESSIONS=src/test_transitions.rs cargo test --lib test_transitions
```

## Coverage

The property-based tests cover:
- ✅ All 6 states in the state machine
- ✅ All valid transitions (7 edges + idempotent)
- ✅ All invalid transitions (20+ combinations)
- ✅ Terminal state immutability
- ✅ Acyclicity of the state graph
- ✅ Determinism of transition validation
- ✅ Reachability constraints (e.g., Disputed only from Failed)

## Integration with CI

These tests run automatically in CI as part of:
```bash
cargo test --lib
```

No additional configuration is required. The tests are gated by `#[cfg(test)]` and only compile in test mode.

## Performance

Property-based tests run quickly because they only test the state machine logic (no contract invocation):
- ~100 test cases per property (configurable)
- Total runtime: <1 second for all property tests
- No external dependencies or network calls

## Future Enhancements

Potential extensions:
1. **Sequence-based properties**: Generate arbitrary sequences of transitions and verify invariants hold
2. **Concurrency properties**: Verify state machine safety under concurrent access
3. **Regression tests**: Add failing cases discovered in production to the test suite
4. **Fuzzing**: Integrate with libFuzzer for continuous fuzzing of transition logic

## References

- [proptest documentation](https://docs.rs/proptest/)
- [Property-based testing guide](https://hypothesis.works/articles/what-is-property-based-testing/)
- State machine design: `src/transitions.rs`, `src/types.rs`
