# State Machine Testing Guide

## Quick Reference

### Running Tests

```bash
# All transition tests (unit + property-based)
cargo test --lib test_transitions

# Only property-based tests
cargo test --lib test_transitions prop_

# With detailed output
cargo test --lib test_transitions -- --nocapture --test-threads=1
```

### Test Categories

#### Unit Tests (Deterministic)
Located in `src/transitions.rs` and `src/test_transitions.rs`:
- `test_valid_transition_*` - Verify specific valid transitions
- `test_invalid_transition_*` - Verify specific invalid transitions
- `test_idempotent_transition_*` - Verify same-state transitions
- `test_is_terminal_status_*` - Verify terminal state detection
- `test_valid_next_states_*` - Verify state graph structure
- `test_lifecycle_*` - End-to-end remittance flows
- `test_state_machine_graph_coverage` - Verify all edges exist
- `test_terminal_states_comprehensive` - Verify terminal immutability

#### Property-Based Tests (Randomized)
Located in `src/test_transitions.rs`:
- `prop_terminal_states_are_immutable` - Terminal states cannot transition
- `prop_valid_transitions_allowed` - Valid transitions are allowed
- `prop_invalid_transitions_rejected` - Invalid transitions are rejected
- `prop_idempotent_transitions_allowed` - Same-state transitions work
- `prop_terminal_states_block_further_transitions` - Terminal finality
- `prop_no_cycles_in_state_graph` - State graph is acyclic
- `prop_disputed_only_from_failed` - Dispute reachability
- `prop_pending_is_initial_only` - Initial state uniqueness
- `prop_non_terminal_states_have_exits` - No stuck states
- `prop_transition_validation_is_deterministic` - Reproducible behavior

## State Machine Overview

```
Pending ──→ Processing ──→ Completed (terminal)
  │           │
  └───→ Failed ──→ Disputed
  │           │
  └───────────┴──→ Cancelled (terminal)
```

### Valid Transitions

| From | To | Reason |
|------|----|----|
| Pending | Processing | Agent accepts payout |
| Pending | Cancelled | Sender cancels |
| Pending | Failed | Payout fails immediately |
| Processing | Completed | Payout confirmed |
| Processing | Cancelled | Payout fails during processing |
| Processing | Failed | Payout fails |
| Failed | Disputed | Sender disputes failure |
| Any | Same | Idempotent (safe for retries) |

### Terminal States

- **Completed**: Payout confirmed, funds released to agent
- **Cancelled**: Remittance cancelled, funds refunded to sender

Terminal states cannot transition further.

## Adding New Tests

### Unit Test Template

```rust
#[test]
fn test_my_transition() {
    let from = RemittanceStatus::Pending;
    let to = RemittanceStatus::Processing;
    
    assert!(from.can_transition_to(&to));
}
```

### Property Test Template

```rust
proptest! {
    #[test]
    fn prop_my_invariant(status in arb_status()) {
        // Your invariant check here
        prop_assert!(status.is_terminal() || /* condition */);
    }
}
```

## Debugging Failed Tests

### Property Test Failures

When a property test fails, proptest:
1. Shrinks the input to a minimal reproducer
2. Saves the seed to `proptest/regressions/src_test_transitions_rs.txt`
3. Replays the same seed on subsequent runs

To debug:
```bash
# Run with the saved seed (automatic)
cargo test --lib test_transitions prop_my_test

# View the regression file
cat proptest/regressions/src_test_transitions_rs.txt
```

### Unit Test Failures

For unit tests, check:
1. The transition is in the valid set
2. The state machine graph is correct
3. Terminal states are properly marked

## Invariants Verified

✅ **Immutability**: Terminal states cannot transition  
✅ **Validity**: Only defined transitions are allowed  
✅ **Idempotency**: Same-state transitions are safe  
✅ **Acyclicity**: No cycles in state graph  
✅ **Reachability**: Disputed only from Failed  
✅ **Initialization**: Pending is initial-only  
✅ **Completeness**: Non-terminal states have exits  
✅ **Determinism**: Validation is reproducible  

## Performance

- Unit tests: <100ms
- Property tests: <1s (100 cases per property)
- Total: <2s for all transition tests

## CI Integration

Tests run automatically in CI:
```bash
cargo test --lib
```

Failures block PR merges. To check locally before pushing:
```bash
cargo test --lib test_transitions
```

## Common Issues

### "Terminal state should not transition"
**Cause**: Trying to transition from `Completed` or `Cancelled`  
**Fix**: Check that the state is not terminal before transitioning

### "Invalid transition"
**Cause**: Attempting a transition not in the state graph  
**Fix**: Verify the transition is in the valid set (see table above)

### "Idempotent transition failed"
**Cause**: Same-state transition rejected  
**Fix**: Ensure `can_transition_to()` allows same-state transitions

## References

- **Implementation**: `src/transitions.rs`
- **Types**: `src/types.rs` (RemittanceStatus enum)
- **Tests**: `src/test_transitions.rs`
- **Documentation**: `PROPERTY_BASED_TESTS.md`
