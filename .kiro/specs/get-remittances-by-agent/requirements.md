# Requirements Document

## Introduction

Agents in the SwiftRemit contract need to query all remittances assigned to them so they know which ones to process. Currently there is no indexed lookup by agent address — the only way to find an agent's remittances is to scan every remittance ID, which is impractical on-chain. This feature adds an `AgentRemittances(Address)` storage index that is populated on `create_remittance` and exposes a `get_remittances_by_agent(agent, offset, limit)` view function returning paginated remittance IDs.

## Glossary

- **Contract**: The SwiftRemit Soroban smart contract (`SwiftRemitContract`).
- **Agent**: A registered address that receives and processes remittance payouts.
- **Remittance**: A cross-border payment record identified by a unique `u64` ID.
- **AgentIndex**: The `AgentRemittances(Address)` persistent storage key holding a `Vec<u64>` of remittance IDs assigned to a given agent.
- **Caller**: Any address invoking a Contract view function.
- **Offset**: Zero-based index of the first result to return in a paginated query.
- **Limit**: Maximum number of results to return in a single paginated query.

## Requirements

### Requirement 1: Agent Remittance Index Maintenance

**User Story:** As an agent, I want every remittance assigned to me to be recorded in an index at creation time, so that I can later retrieve them without scanning all IDs.

#### Acceptance Criteria

1. WHEN `create_remittance` is called with a valid agent address, THE Contract SHALL append the new remittance ID to the AgentIndex for that agent address.
2. WHEN `create_remittance_with_corridor` is called with a valid agent address, THE Contract SHALL append the new remittance ID to the AgentIndex for that agent address.
3. THE Contract SHALL store the AgentIndex under the `DataKey::AgentRemittances(Address)` persistent storage key.
4. THE Contract SHALL preserve insertion order in the AgentIndex so that remittance IDs are stored in creation order.

### Requirement 2: Paginated Query by Agent

**User Story:** As an agent, I want to call `get_remittances_by_agent(agent, offset, limit)` and receive a page of my remittance IDs, so that I can process them efficiently without loading the entire list.

#### Acceptance Criteria

1. WHEN `get_remittances_by_agent` is called with a registered agent address, THE Contract SHALL return a `Vec<u64>` containing remittance IDs assigned to that agent, starting at `offset` and containing at most `limit` entries.
2. WHEN `get_remittances_by_agent` is called with an address that has no remittances, THE Contract SHALL return an empty `Vec<u64>` without returning an error.
3. WHEN `get_remittances_by_agent` is called with an `offset` greater than or equal to the total number of remittances for that agent, THE Contract SHALL return an empty `Vec<u64>`.
4. WHEN `get_remittances_by_agent` is called with a `limit` of zero, THE Contract SHALL return an empty `Vec<u64>`.
5. WHEN `get_remittances_by_agent` is called with a `limit` greater than 100, THE Contract SHALL cap the effective limit at 100 and return at most 100 IDs.
6. THE Contract SHALL return IDs in creation order (ascending by remittance ID).

### Requirement 3: Pagination Correctness

**User Story:** As a developer integrating with the Contract, I want pagination to be consistent and non-overlapping, so that iterating through pages yields every remittance exactly once.

#### Acceptance Criteria

1. WHEN `get_remittances_by_agent` is called with consecutive non-overlapping `offset` values and the same `limit`, THE Contract SHALL return non-overlapping slices that together cover all remittance IDs for that agent.
2. WHEN `get_remittances_by_agent` is called and the remaining items are fewer than `limit`, THE Contract SHALL return only the remaining items without padding or error.
3. THE Contract SHALL NOT modify any state when `get_remittances_by_agent` is called (pure view function).
