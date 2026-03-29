# Design Document: get-remittances-by-agent

## Overview

This feature adds an agent-keyed remittance index to the SwiftRemit Soroban contract so that agents can efficiently retrieve all remittances assigned to them via a paginated view function — without scanning every remittance ID.

The solution is minimal: a new `DataKey::AgentRemittances(Address)` persistent storage entry holds a `Vec<u64>` of remittance IDs in creation order. It is appended to on every `create_remittance` and `create_remittance_with_corridor` call. A new `get_remittances_by_agent(agent, offset, limit)` view function slices this vector and returns the requested page.

## Architecture

```
create_remittance / create_remittance_with_corridor
        │
        ▼
  append_agent_remittance(env, &agent, remittance_id)   ← new storage helper
        │
        ▼
  DataKey::AgentRemittances(Address)  →  Vec<u64>  (persistent storage)
        │
        ▼
  get_remittances_by_agent(agent, offset, limit)         ← new view function
        │
        ▼
  Vec<u64>  (paginated slice, max 100 entries)
```

No existing state transitions, fee logic, or settlement flows are modified. The index is append-only and is never mutated after insertion.

## Components and Interfaces

### Storage Layer (`src/storage.rs`)

**New `DataKey` variant**

```rust
/// Remittance IDs assigned to an agent, in creation order (persistent storage)
AgentRemittances(Address),
```

**New helper functions**

```rust
/// Appends a remittance ID to the agent's index.
pub fn append_agent_remittance(env: &Env, agent: &Address, remittance_id: u64)

/// Returns a paginated slice of remittance IDs for an agent.
/// Returns an empty Vec if the agent has no remittances.
pub fn get_agent_remittances(env: &Env, agent: &Address, offset: u32, limit: u32) -> Vec<u64>
```

### Contract Layer (`src/lib.rs`)

**Modifications to `create_remittance`**

After `set_remittance_counter`, add:

```rust
append_agent_remittance(&env, &agent, remittance_id);
```

**Modifications to `create_remittance_with_corridor`**

Same insertion point — after `set_remittance_counter`:

```rust
append_agent_remittance(&env, &agent, remittance_id);
```

**New view function**

```rust
pub fn get_remittances_by_agent(
    env: Env,
    agent: Address,
    offset: u32,
    limit: u32,
) -> Vec<u64>
```

- No authorization required (view function, callable by anyone).
- Delegates entirely to `get_agent_remittances`.

## Data Models

### `DataKey::AgentRemittances(Address)`

| Field | Type | Description |
|-------|------|-------------|
| key | `Address` | The agent's address |
| value | `Vec<u64>` | Remittance IDs in insertion (creation) order |

Storage type: **persistent** (same as `Remittance(u64)` records).

### Pagination Parameters

| Parameter | Type | Constraints |
|-----------|------|-------------|
| `offset` | `u32` | Zero-based start index; returns empty if >= total count |
| `limit` | `u32` | Max results; capped at 100; returns empty if 0 |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

---

Property 1: Index append on creation
*For any* registered agent and any sequence of `create_remittance` or `create_remittance_with_corridor` calls, each newly created remittance ID must appear in the result of `get_remittances_by_agent` for that agent (using offset=0, limit=100).
**Validates: Requirements 1.1, 1.2**

---

Property 2: Pagination full coverage
*For any* agent with N remittances and any page size L (1 ≤ L ≤ 100), iterating through all pages (offset = 0, L, 2L, …) and concatenating the results must yield exactly the same set of N remittance IDs as a single query with offset=0, limit=100 — with no duplicates and no omissions.
**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.1, 3.2**

---

Property 3: Limit cap at 100
*For any* agent with more than 100 remittances, calling `get_remittances_by_agent` with any `limit` value greater than 100 must return at most 100 IDs.
**Validates: Requirements 2.5**

---

Property 4: Creation order preserved
*For any* agent, the IDs returned by `get_remittances_by_agent` (offset=0, limit=N) must be in strictly ascending order, matching the order in which the remittances were created.
**Validates: Requirements 1.4, 2.6**

---

Property 5: View purity (idempotence)
*For any* agent and any pagination parameters, calling `get_remittances_by_agent` twice in succession must return identical results, and the agent's index must be unchanged after the call.
**Validates: Requirements 3.3**

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Agent has no remittances (never created any) | Returns empty `Vec<u64>` — no error |
| `offset` >= total remittance count for agent | Returns empty `Vec<u64>` — no error |
| `limit` == 0 | Returns empty `Vec<u64>` — no error |
| `limit` > 100 | Capped to 100; returns at most 100 IDs |
| Agent address is valid but unregistered | Returns empty `Vec<u64>` — no error (index simply absent) |

No new error variants are needed. The function is infallible by design.

## Testing Strategy

### Unit Tests (`src/test.rs` or a new `src/test_agent_index.rs`)

Focus on specific examples and edge cases:

- Creating one remittance and verifying it appears in the index
- Creating remittances for two different agents and verifying isolation (agent A's index does not contain agent B's IDs)
- Querying with offset=0, limit=0 returns empty
- Querying with offset beyond the list returns empty
- Querying with limit=200 returns at most 100 IDs
- Verifying `create_remittance_with_corridor` also populates the index

### Property-Based Tests (`src/test_property.rs`)

Use `proptest` (already a dependency). Minimum 100 iterations per property.

Each property test must be tagged with:
**Feature: get-remittances-by-agent, Property N: {property_text}**

**Property 1 test** — Index append on creation
Generate a random agent and a random count of remittances (1–20). After creating all of them, query with offset=0, limit=100 and assert every created ID is present.

**Property 2 test** — Pagination full coverage
Generate a random agent with N remittances (1–50) and a random page size L (1–20). Iterate all pages and assert the union equals the full set with no duplicates.

**Property 3 test** — Limit cap
Generate an agent with 110+ remittances. Query with limit=u32::MAX. Assert result length <= 100.

**Property 4 test** — Creation order
Generate a random agent with N remittances (2–20). Query all. Assert IDs are strictly ascending.

**Property 5 test** — View purity
Generate a random agent with N remittances. Call `get_remittances_by_agent` twice. Assert both calls return identical results.

Both unit tests and property tests are required. Unit tests catch concrete bugs and edge cases; property tests verify universal correctness across all inputs.
