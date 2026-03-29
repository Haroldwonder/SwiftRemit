# Implementation Plan: get-remittances-by-agent

## Overview

Add an agent-keyed remittance index to the SwiftRemit Soroban contract. The work is split into three incremental steps: storage layer, contract wiring, and tests.

## Tasks

- [ ] 1. Add `AgentRemittances` storage key and helper functions
  - Add `AgentRemittances(Address)` variant to the `DataKey` enum in `src/storage.rs`
  - Implement `append_agent_remittance(env, agent, remittance_id)` — loads the existing `Vec<u64>` (or creates an empty one), pushes the new ID, and writes it back to persistent storage
  - Implement `get_agent_remittances(env, agent, offset, limit)` — loads the vec (defaulting to empty), applies the offset/limit slice (capping limit at 100), and returns the result as a new `Vec<u64>`
  - _Requirements: 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.2_

- [ ] 2. Wire index into remittance creation and expose view function
  - [ ] 2.1 Update `create_remittance` in `src/lib.rs` to call `append_agent_remittance(&env, &agent, remittance_id)` immediately after `set_remittance_counter`
    - _Requirements: 1.1_
  - [ ] 2.2 Update `create_remittance_with_corridor` in `src/lib.rs` to call `append_agent_remittance(&env, &agent, remittance_id)` immediately after `set_remittance_counter`
    - _Requirements: 1.2_
  - [ ] 2.3 Add `get_remittances_by_agent(env, agent, offset, limit) -> Vec<u64>` public view function to `SwiftRemitContract` in `src/lib.rs`; delegate entirely to `get_agent_remittances`
    - No authorization required
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.3_

- [ ] 3. Checkpoint — ensure the contract compiles and existing tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Write unit tests for the agent index
  - [ ] 4.1 Add unit tests in a new `src/test_agent_index.rs` module (or append to `src/test.rs`)
    - Test: single remittance appears in index after `create_remittance`
    - Test: single remittance appears in index after `create_remittance_with_corridor`
    - Test: two agents' indexes are isolated (no cross-contamination)
    - Test: offset=0, limit=0 returns empty vec
    - Test: offset beyond list length returns empty vec
    - Test: limit > 100 is capped to 100
    - _Requirements: 1.1, 1.2, 2.2, 2.3, 2.4, 2.5_
  - [ ]* 4.2 Write property test for index append on creation (Property 1)
    - **Property 1: Index append on creation**
    - Generate random agent and 1–20 remittances; assert every created ID is present in query results
    - Tag: `Feature: get-remittances-by-agent, Property 1: Index append on creation`
    - **Validates: Requirements 1.1, 1.2**
  - [ ]* 4.3 Write property test for pagination full coverage (Property 2)
    - **Property 2: Pagination full coverage**
    - Generate agent with 1–50 remittances and random page size 1–20; iterate all pages; assert union equals full set with no duplicates
    - Tag: `Feature: get-remittances-by-agent, Property 2: Pagination full coverage`
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.1, 3.2**
  - [ ]* 4.4 Write property test for limit cap at 100 (Property 3)
    - **Property 3: Limit cap at 100**
    - Create agent with 110+ remittances; query with limit=u32::MAX; assert result length <= 100
    - Tag: `Feature: get-remittances-by-agent, Property 3: Limit cap at 100`
    - **Validates: Requirements 2.5**
  - [ ]* 4.5 Write property test for creation order preserved (Property 4)
    - **Property 4: Creation order preserved**
    - Generate agent with 2–20 remittances; query all; assert IDs are strictly ascending
    - Tag: `Feature: get-remittances-by-agent, Property 4: Creation order preserved`
    - **Validates: Requirements 1.4, 2.6**
  - [ ]* 4.6 Write property test for view purity (Property 5)
    - **Property 5: View purity**
    - Generate agent with N remittances; call `get_remittances_by_agent` twice; assert identical results
    - Tag: `Feature: get-remittances-by-agent, Property 5: View purity`
    - **Validates: Requirements 3.3**

- [ ] 5. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests use `proptest` (already a dependency); configure each with `ProptestConfig::with_cases(100)`
- The `AgentRemittances` vec grows unboundedly — callers must use pagination for large agents
- No existing storage keys, state transitions, or fee logic are modified
