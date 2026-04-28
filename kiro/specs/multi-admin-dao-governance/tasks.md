# Implementation Tasks: Multi-Admin / DAO Governance Support

## Overview

These tasks implement the governance proposal lifecycle on top of the existing
multi-admin scaffolding in SwiftRemit. Work is ordered so each task compiles and
passes tests independently before the next begins.

---

## Task 1: Extend types, errors, and events

- [ ] 1.1 Add `ProposalAction`, `ProposalState`, and `Proposal` types to `src/types.rs`
  - `ProposalAction` enum: `UpdateFee(u32)`, `RegisterAgent(Address)`, `RemoveAgent(Address)`, `AddAdmin(Address)`, `RemoveAdmin(Address)`, `UpdateQuorum(u32)`, `UpdateTimelock(u64)`
  - `ProposalState` enum: `Pending`, `Approved`, `Executed`, `Expired`
  - `Proposal` struct: `id`, `proposer`, `action`, `state`, `created_at`, `expiry`, `approval_count`, `approval_timestamp: Option<u64>`
  - All types annotated with `#[contracttype]`

- [ ] 1.2 Add new `ContractError` variants to `src/errors.rs` starting at code 63
  - `ProposalAlreadyPending = 63`
  - `ProposalNotFound = 64`
  - `InvalidProposalState = 65`
  - `TimelockNotElapsed = 66`
  - `AlreadyAdmin = 67`
  - `InsufficientAdmins = 68`
  - `AgentAlreadyRegistered = 69`
  - `GovernanceAlreadyInitialized = 70`

- [ ] 1.3 Add governance event emission functions to `src/events.rs`
  - `emit_proposal_created(env, proposal_id, proposer, action_type, expiry)`
  - `emit_proposal_voted(env, proposal_id, voter, approval_count)`
  - `emit_proposal_approved(env, proposal_id, approval_timestamp)`
  - `emit_proposal_executed(env, proposal_id, executor)`
  - `emit_proposal_expired(env, proposal_id)`
  - `emit_governance_admin_added(env, admin, proposal_id)`
  - `emit_governance_admin_removed(env, admin, proposal_id)`
  - `emit_fee_update_proposed(env, proposal_id, fee_bps)`
  - `emit_agent_management_proposed(env, proposal_id, agent, action)`

**Validates:** Requirements 5.3, 6.5, 8.1–8.7

---

## Task 2: Extend storage with governance keys and accessors

- [ ] 2.1 Add new `DataKey` variants to the enum in `src/storage.rs`
  - `GovernanceProposalCounter` (instance)
  - `GovernanceProposal(u64)` (persistent)
  - `GovernanceVote(u64, Address)` (persistent)
  - `GovernanceQuorum` (instance)
  - `GovernanceTimelockSeconds` (instance)
  - `GovernanceProposalTtl` (instance)
  - `ActiveFeeProposal` (instance)
  - `GovernanceInitialized` (instance)
  - `AdminList` (instance)

- [ ] 2.2 Add proposal CRUD accessors
  - `get_proposal(env, id) -> Result<Proposal, ContractError>`
  - `set_proposal(env, proposal: &Proposal)`
  - `next_proposal_id(env) -> u64` (increments counter and returns new ID)

- [ ] 2.3 Add vote tracking accessors
  - `has_governance_voted(env, proposal_id, voter) -> bool`
  - `record_governance_vote(env, proposal_id, voter)`

- [ ] 2.4 Add governance config accessors
  - `get_governance_quorum(env) -> u32`
  - `set_governance_quorum(env, quorum)`
  - `get_governance_timelock(env) -> u64`
  - `set_governance_timelock(env, seconds)`
  - `get_proposal_ttl(env) -> u64`
  - `set_proposal_ttl(env, seconds)`

- [ ] 2.5 Add admin list accessors
  - `get_admin_list(env) -> Vec<Address>`
  - `add_admin_to_list(env, admin: &Address)`
  - `remove_admin_from_list(env, admin: &Address)`

- [ ] 2.6 Add active proposal guard accessors
  - `get_active_fee_proposal(env) -> Option<u64>`
  - `set_active_fee_proposal(env, proposal_id: Option<u64>)`

- [ ] 2.7 Add governance initialization flag accessors
  - `is_governance_initialized(env) -> bool`
  - `set_governance_initialized(env)`

**Validates:** Requirements 1.8, 2.5, 3.4, 4.13

---

## Task 3: Implement `src/governance.rs` — core proposal logic

- [ ] 3.1 Create `src/governance.rs` and implement `do_propose`
  - Verify caller holds `Role::Admin` (return `Unauthorized` if not)
  - Reject if contract is paused (`ContractPaused`)
  - Validate action-specific preconditions at proposal creation time:
    - `UpdateFee(bps)`: reject if `bps > 10000` (`InvalidFeeBps`); reject if active fee proposal exists (`ProposalAlreadyPending`)
    - `RegisterAgent(addr)`: reject if agent already registered (`AgentAlreadyRegistered`)
    - `RemoveAgent(addr)`: reject if agent not registered (`AgentNotRegistered`)
    - `AddAdmin(addr)`: reject if address already holds `Role::Admin` (`AlreadyAdmin`)
    - `RemoveAdmin(addr)`: reject if removal would drop count below quorum or below 1 (`InsufficientAdmins`)
  - Allocate new proposal ID via `next_proposal_id`
  - Store `Proposal` with `state = Pending`, `created_at`, `expiry = created_at + ttl`, `approval_count = 0`
  - Set `ActiveFeeProposal` flag for fee proposals
  - Emit `ProposalCreated` event (and action-specific event)
  - Return `proposal_id`

- [ ] 3.2 Implement `do_vote`
  - Verify caller holds `Role::Admin`
  - Load proposal; return `ProposalNotFound` if missing
  - Return `InvalidProposalState` if proposal is not `Pending`
  - Return `AlreadyVoted` if caller already voted
  - Record vote; increment `approval_count`
  - Emit `ProposalVoted` event
  - If `approval_count >= quorum`: set `state = Approved`, record `approval_timestamp`, emit `ProposalApproved`

- [ ] 3.3 Implement `do_execute`
  - Verify caller holds `Role::Admin`
  - Load proposal; return `ProposalNotFound` if missing
  - Return `InvalidProposalState` if not `Approved`
  - Return `TimelockNotElapsed` if `now < approval_timestamp + timelock_seconds`
  - Dispatch action:
    - `UpdateFee(bps)`: call existing fee update logic; clear `ActiveFeeProposal`; emit `FeeUpdated`
    - `RegisterAgent(addr)`: call existing agent registration logic; emit `AgentRegistered`
    - `RemoveAgent(addr)`: call existing agent removal logic; emit `AgentRemoved`
    - `AddAdmin(addr)`: grant `Role::Admin`, increment admin count, add to admin list, update legacy `Admin` key if first multi-admin; emit `AdminAdded` + `GovernanceAdminAdded`
    - `RemoveAdmin(addr)`: revoke `Role::Admin`, decrement admin count, remove from admin list; emit `AdminRemoved` + `GovernanceAdminRemoved`
    - `UpdateQuorum(q)`: validate `1 <= q <= admin_count`; store new quorum
    - `UpdateTimelock(s)`: store new timelock
  - Set `state = Executed`; emit `ProposalExecuted`

- [ ] 3.4 Implement `do_expire`
  - Load proposal; return `ProposalNotFound` if missing
  - Return `InvalidProposalState` if not `Pending` or `Approved`
  - Return `InvalidProposalState` if `now < expiry` (not yet expired)
  - Set `state = Expired`; clear `ActiveFeeProposal` if applicable; emit `ProposalExpired`

- [ ] 3.5 Implement `do_migrate`
  - Verify caller is the legacy `DataKey::Admin` address
  - Return `GovernanceAlreadyInitialized` if already initialized
  - Validate `quorum` in `[1, admin_count]`; return `InvalidQuorum` if not
  - Store quorum, timelock, proposal TTL
  - Seed `AdminList` from existing admin role holders (at minimum the legacy admin)
  - Set `GovernanceInitialized` flag

**Validates:** Requirements 1–7, 9

---

## Task 4: Expose governance entry points in `src/lib.rs`

- [ ] 4.1 Add `mod governance;` declaration and import `governance::*` functions

- [ ] 4.2 Add public entry points to `SwiftRemitContract` impl

  ```rust
  pub fn propose(env: Env, proposer: Address, action: ProposalAction) -> Result<u64, ContractError>
  pub fn vote(env: Env, voter: Address, proposal_id: u64) -> Result<(), ContractError>
  pub fn execute(env: Env, executor: Address, proposal_id: u64) -> Result<(), ContractError>
  pub fn expire_proposal(env: Env, caller: Address, proposal_id: u64) -> Result<(), ContractError>
  pub fn migrate_to_governance(env: Env, caller: Address, quorum: u32, timelock_seconds: u64, proposal_ttl_seconds: u64) -> Result<(), ContractError>
  ```

  Each function calls `caller.require_auth()` then delegates to the corresponding `do_*` function.

- [ ] 4.3 Add read-only query entry points
  ```rust
  pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, ContractError>
  pub fn get_admins(env: Env) -> Vec<Address>
  pub fn get_quorum(env: Env) -> u32
  pub fn get_timelock_seconds(env: Env) -> u64
  ```

**Validates:** Requirements 1.8, 2.5, 3.4, 4.1–4.13

---

## Task 5: Unit tests (`src/test_governance.rs`)

- [ ] 5.1 Test `migrate_to_governance` happy path and double-call rejection
- [ ] 5.2 Test full `UpdateFee` proposal lifecycle: propose → vote → execute
- [ ] 5.3 Test full `RegisterAgent` proposal lifecycle
- [ ] 5.4 Test full `RemoveAgent` proposal lifecycle
- [ ] 5.5 Test full `AddAdmin` proposal lifecycle including admin list and legacy key update
- [ ] 5.6 Test full `RemoveAdmin` proposal lifecycle
- [ ] 5.7 Test `UpdateQuorum` and `UpdateTimelock` proposals
- [ ] 5.8 Test timelock enforcement: execute before and after timelock elapses
- [ ] 5.9 Test proposal expiry via `expire_proposal`
- [ ] 5.10 Test single-admin mode: propose auto-reaches quorum, execute succeeds immediately
- [ ] 5.11 Test all error conditions: `Unauthorized`, `AlreadyVoted`, `InvalidProposalState`, `TimelockNotElapsed`, `ProposalAlreadyPending`, `InsufficientAdmins`, `AlreadyAdmin`, `AgentAlreadyRegistered`, `AgentNotRegistered`, `GovernanceAlreadyInitialized`
- [ ] 5.12 Test event emission for all 9 event types
- [ ] 5.13 Test `get_admin()` backward compatibility returns legacy admin after governance init

**Validates:** Requirements 1–9 (example-based coverage)

---

## Task 6: Property-based tests (`src/test_governance_property.rs`)

- [ ] 6.1 Add `proptest = "1"` to `[dev-dependencies]` in `Cargo.toml`

- [ ] 6.2 Implement 18 property tests (minimum 100 iterations each), one per correctness property in `design.md`:

  | Task   | Property | Description                                                        |
  | ------ | -------- | ------------------------------------------------------------------ |
  | 6.2.1  | P1       | Admin count bounds invariant across random add/remove sequences    |
  | 6.2.2  | P2       | `get_admins()` matches `Role::Admin` holders exactly               |
  | 6.2.3  | P3       | Invalid quorum values (0 or > admin_count) always rejected         |
  | 6.2.4  | P4       | Valid quorum update round-trip                                     |
  | 6.2.5  | P5       | Timelock update round-trip                                         |
  | 6.2.6  | P6       | Proposal IDs are unique and monotonically increasing               |
  | 6.2.7  | P7       | Non-admin callers always get `Unauthorized`                        |
  | 6.2.8  | P8       | Double-vote always returns `AlreadyVoted`                          |
  | 6.2.9  | P9       | Exactly Q votes transitions proposal to `Approved`                 |
  | 6.2.10 | P10      | Wrong-state execute returns `InvalidProposalState`; replay blocked |
  | 6.2.11 | P11      | `expire_proposal` succeeds after TTL                               |
  | 6.2.12 | P12      | Fee update proposal round-trip                                     |
  | 6.2.13 | P13      | `fee_bps > 10000` rejected at propose time                         |
  | 6.2.14 | P14      | Second active fee proposal returns `ProposalAlreadyPending`        |
  | 6.2.15 | P15      | Agent register/remove round-trip                                   |
  | 6.2.16 | P16      | Single-admin mode allows immediate execution                       |
  | 6.2.17 | P17      | `approval_count` never exceeds admin count                         |
  | 6.2.18 | P18      | `propose` while paused returns `ContractPaused`                    |

  Each test must include the comment tag:
  `// Feature: multi-admin-dao-governance, Property N: <property_text>`

**Validates:** All 18 correctness properties in design.md
