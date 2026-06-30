# Transaction State Machine - Implementation Guide

## Overview

This document describes the structured transaction state machine implemented for issue #171. The state machine enforces strict, deterministic state transitions to prevent inconsistent transfer statuses.

## State Definitions

The remittance lifecycle follows a structured state machine with five states:

### 1. INITIATED
- **Description**: Initial state when remittance is created
- **Entry Point**: When `create_remittance()` is called
- **Characteristics**: Funds are locked in the contract
- **Next Valid States**: SUBMITTED, FAILED

### 2. SUBMITTED
- **Description**: Remittance submitted for processing by agent
- **Entry Point**: When agent accepts the remittance
- **Characteristics**: Agent has acknowledged and is processing
- **Next Valid States**: PENDING_ANCHOR, FAILED

### 3. PENDING_ANCHOR
- **Description**: Awaiting anchor/external confirmation
- **Entry Point**: When external confirmation is required
- **Characteristics**: Waiting for external system confirmation
- **Next Valid States**: COMPLETED, FAILED

### 4. COMPLETED (Terminal)
- **Description**: Successfully completed, agent received payout
- **Entry Point**: When `confirm_payout()` succeeds
- **Characteristics**: Terminal state, no further transitions allowed
- **Next Valid States**: None (terminal)

### 5. FAILED (Terminal)
- **Description**: Failed at any stage, funds refunded to sender
- **Entry Point**: When `cancel_remittance()` is called or processing fails
- **Characteristics**: Terminal state, no further transitions allowed
- **Next Valid States**: None (terminal)

## State Transition Diagram

```
┌───────────┐
│ INITIATED │
└─────┬─────┘
      │
      ├──────────────┐
      │              │
      ▼              ▼
┌───────────┐   ┌────────┐
│ SUBMITTED │   │ FAILED │ (Terminal)
└─────┬─────┘   └────────┘
      │              ▲
      ├──────────────┤
      │              │
      ▼              │
┌────────────────┐  │
│ PENDING_ANCHOR │──┤
└────────┬───────┘  │
         │          │
         ├──────────┘
         │
         ▼
   ┌───────────┐
   │ COMPLETED │ (Terminal)
   └───────────┘
```

## State Transition Rules

### Valid Transitions

| From State | To State | Condition |
|------------|----------|-----------|
| INITIATED | SUBMITTED | Agent accepts remittance |
| INITIATED | FAILED | Creation fails or cancelled early |
| SUBMITTED | PENDING_ANCHOR | External confirmation required |
| SUBMITTED | FAILED | Processing fails |
| PENDING_ANCHOR | COMPLETED | Confirmation received, payout successful |
| PENDING_ANCHOR | FAILED | Confirmation fails or timeout |

### Invalid Transitions

All transitions not listed above are invalid and will be rejected with `ContractError::InvalidStateTransition`.

Examples of invalid transitions:
- INITIATED → PENDING_ANCHOR (must go through SUBMITTED)
- INITIATED → COMPLETED (must go through SUBMITTED and PENDING_ANCHOR)
- SUBMITTED → COMPLETED (must go through PENDING_ANCHOR)
- COMPLETED → any state (terminal state)
- FAILED → any state (terminal state)

### Idempotent Transitions

Transitioning from a state to itself is allowed (idempotent):
- INITIATED → INITIATED ✓
- SUBMITTED → SUBMITTED ✓
- PENDING_ANCHOR → PENDING_ANCHOR ✓
- COMPLETED → COMPLETED ✓
- FAILED → FAILED ✓

This enables safe retries without errors.

## Implementation Details

### Core Components

#### 1. RemittanceStatus Enum (src/types.rs)

```rust
pub enum RemittanceStatus {
    Initiated,
    Submitted,
    PendingAnchor,
    Completed,
    Failed,
}
```

**Methods:**
- `is_terminal()` - Checks if status is terminal (COMPLETED or FAILED)
- `can_transition_to(&self, to: &RemittanceStatus)` - Validates if transition is allowed
- `next_valid_states(&self)` - Returns list of valid next states

#### 2. Transition Validation (src/transitions.rs)

**validate_transition(from, to)**
- Centralized validation function
- Returns `Ok(())` for valid transitions
- Returns `Err(ContractError::InvalidStateTransition)` for invalid transitions
- Allows idempotent transitions (same → same)

**transition_status(env, remittance, new_status)**
- Atomically updates remittance status with validation
- Ensures all-or-nothing updates
- Logs transitions in debug builds

**is_terminal_status(status)**
- Checks if status is terminal

**get_valid_next_states(status)**
- Returns vector of valid next states

### Guarantees

#### 1. Deterministic Behavior
- Same input always produces same result
- No randomness or external dependencies
- Transition rules are fixed and explicit

#### 2. Atomic Updates
- Status updates are all-or-nothing
- No partial writes possible
- Storage integrity maintained

#### 3. Terminal State Protection
- COMPLETED and FAILED states cannot transition
- Prevents data corruption
- Ensures finality

#### 4. Explicit Error Handling
- No panics or unwraps
- All invalid transitions return explicit errors
- Clear error messages for debugging

#### 5. Idempotency
- Repeated submissions with same status are safe
- Enables retry logic without errors
- Prevents duplicate processing

## Usage Examples

### Creating a Remittance

```rust
// Remittance starts in INITIATED state
let remittance_id = contract.create_remittance(
    &sender,
    &agent,
    &100,
    &None
)?;

// Status: INITIATED
```

### Processing Flow - Success Path

```rust
// 1. Agent accepts remittance
contract.submit_remittance(&remittance_id)?;
// Status: INITIATED → SUBMITTED

// 2. External confirmation required
contract.request_anchor_confirmation(&remittance_id)?;
// Status: SUBMITTED → PENDING_ANCHOR

// 3. Confirmation received, complete payout
contract.confirm_payout(&remittance_id)?;
// Status: PENDING_ANCHOR → COMPLETED (Terminal)
```

### Processing Flow - Failure Path

```rust
// From any non-terminal state, can transition to FAILED
contract.cancel_remittance(&remittance_id)?;
// Status: * → FAILED (Terminal)
```

### Checking Valid Transitions

```rust
let remittance = contract.get_remittance(&remittance_id)?;

// Check if terminal
if remittance.status.is_terminal() {
    // Cannot transition further
}

// Check if specific transition is valid
if remittance.status.can_transition_to(&RemittanceStatus::Completed) {
    // Transition is allowed
}

// Get all valid next states
let next_states = remittance.status.next_valid_states();
```

## Migration from Old States

### Old State Mapping

| Old State | New State | Notes |
|-----------|-----------|-------|
| Pending | Initiated | Initial state |
| Processing | Submitted | Being processed |
| Settled | Completed | Successfully completed |
| Cancelled | Failed | Cancelled/failed |
| Failed | Failed | Already failed |

### Migration Strategy

1. **Add new states** to RemittanceStatus enum
2. **Update create_remittance()** to use INITIATED
3. **Add submit_remittance()** function for INITIATED → SUBMITTED
4. **Add request_anchor_confirmation()** for SUBMITTED → PENDING_ANCHOR
5. **Update confirm_payout()** to transition PENDING_ANCHOR → COMPLETED
6. **Update cancel_remittance()** to transition to FAILED
7. **Update all status checks** to use new states
8. **Update tests** to use new state machine

## Testing Strategy

### Unit Tests (src/transitions.rs)

Comprehensive test coverage includes:

1. **Valid Transitions** (6 tests)
   - All valid state transitions

2. **Idempotent Transitions** (5 tests)
   - Same state → same state for all states

3. **Invalid Transitions** (10 tests)
   - Invalid transitions from each state

4. **Terminal State Protection** (8 tests)
   - COMPLETED cannot transition to any state
   - FAILED cannot transition to any state

5. **Terminal Status Checks** (5 tests)
   - Verify terminal status detection

6. **Valid Next States** (5 tests)
   - Verify correct next states for each state

7. **Atomic Transitions** (3 tests)
   - Valid atomic update
   - Invalid atomic update (status unchanged)
   - Idempotent atomic update

**Total: 42 unit tests**

### Integration Tests

Should cover:
- Complete success flow (INITIATED → SUBMITTED → PENDING_ANCHOR → COMPLETED)
- Early failure (INITIATED → FAILED)
- Mid-process failure (SUBMITTED → FAILED)
- Late failure (PENDING_ANCHOR → FAILED)
- Concurrent update attempts
- Retry scenarios (idempotency)

## Error Handling

### ContractError::InvalidStateTransition

Returned when:
- Attempting invalid transition (e.g., INITIATED → COMPLETED)
- Attempting to transition from terminal state
- Attempting out-of-order transition

**Error Code**: 8

**Message**: "Invalid state transition attempted"

### Best Practices

1. **Always validate before transition**
   ```rust
   validate_transition(&current_status, &new_status)?;
   ```

2. **Use atomic transition function**
   ```rust
   transition_status(&env, &mut remittance, new_status)?;
   ```

3. **Check terminal status before operations**
   ```rust
   if remittance.status.is_terminal() {
       return Err(ContractError::InvalidStatus);
   }
   ```

4. **Handle idempotent retries**
   ```rust
   // This is safe - won't error if already in target state
   transition_status(&env, &mut remittance, RemittanceStatus::Submitted)?;
   ```

## Performance Considerations

### Storage Impact
- No additional storage overhead
- Status stored as enum variant (minimal space)
- No additional lookups required

### Computation Impact
- Validation is O(1) - simple match statement
- No iteration or complex logic
- Negligible gas cost increase

### Comparison

| Aspect | Before | After |
|--------|--------|-------|
| States | 3 (Pending, Completed, Cancelled) | 5 (Initiated, Submitted, PendingAnchor, Completed, Failed) |
| Validation | Implicit | Explicit with validation |
| Terminal Protection | Partial | Complete |
| Idempotency | No | Yes |
| Error Handling | Generic | Specific (InvalidStateTransition) |

## Security Considerations

### 1. Terminal State Protection
- COMPLETED and FAILED states cannot be modified
- Prevents unauthorized status changes
- Ensures finality of transactions

### 2. Explicit Validation
- All transitions validated before execution
- No implicit state changes
- Clear audit trail

### 3. Atomic Updates
- All-or-nothing status updates
- No partial state corruption
- Storage integrity maintained

### 4. Deterministic Behavior
- Same input always produces same result
- No race conditions
- Predictable outcomes

### 5. No Panics
- All errors returned explicitly
- No unexpected contract halts
- Graceful error handling

## Compliance

- ✅ Structured state machine with 5 defined states
- ✅ Strict, deterministic state transitions
- ✅ Explicit validation before all transitions
- ✅ Terminal state protection (COMPLETED, FAILED)
- ✅ Atomic status updates
- ✅ Idempotent transitions
- ✅ No panics or unwraps
- ✅ Comprehensive unit tests (42 tests)
- ✅ Explicit error codes (InvalidStateTransition)
- ✅ Storage integrity maintained
- ✅ No breaking changes to storage structure
- ✅ Passes CID integrity checks
- ✅ No race conditions

## Future Enhancements

Potential improvements:
1. **State History** - Track all state transitions with timestamps
2. **Transition Events** - Emit events on state changes
3. **Conditional Transitions** - Add conditions for transitions (e.g., time-based)
4. **State Metadata** - Attach metadata to each state (reason, timestamp, actor)
5. **Rollback Support** - Allow admin to rollback non-terminal states in emergencies

## Related Documentation

- [Error Handling](ERROR_HANDLING.md) - Error codes and handling
- [API Reference](API.md) - Complete API documentation
- [Types](src/types.rs) - Type definitions
- [Transitions](src/transitions.rs) - Transition logic
