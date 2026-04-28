# Requirements Document

## Introduction

SwiftRemit currently uses a single-admin model where one privileged address controls all
sensitive operations: updating platform fees and managing agent registration. This creates
a single point of failure and trust, which is unacceptable for a production remittance
protocol handling real funds.

This feature replaces the single-admin model with a multi-signature (multi-sig) and
optional DAO voting governance mechanism. Privileged operations — fee updates and agent
management — will require approval from a configurable quorum of admin signers before
execution. An optional time-lock delay can be enforced between proposal approval and
execution to give stakeholders time to react.

The existing `AdminRole` scaffolding in storage (admin count, per-address admin flags)
provides a foundation; this feature builds the full proposal, voting, and execution
lifecycle on top of it.

---

## Glossary

- **Governance_System**: The on-chain multi-sig/DAO governance module added to the
  SwiftRemit Soroban contract.
- **Admin**: An address that holds the `Role::Admin` privilege and may submit and vote
  on governance proposals.
- **Proposal**: A pending governance action (fee update or agent management operation)
  that requires quorum approval before execution.
- **Quorum**: The minimum number of distinct Admin approvals required to execute a
  Proposal. Configured at initialization and updatable via governance.
- **Timelock**: An optional delay (in seconds) between a Proposal reaching quorum and
  the earliest ledger timestamp at which it may be executed.
- **Proposer**: The Admin who creates a Proposal.
- **Voter**: An Admin who casts an approval or rejection vote on a Proposal.
- **Executor**: The Admin who calls the execute function after quorum and timelock
  conditions are satisfied.
- **Fee_Update_Proposal**: A Proposal whose action is to change the platform fee in
  basis points.
- **Agent_Management_Proposal**: A Proposal whose action is to register or remove an
  agent address.
- **Admin_Management_Proposal**: A Proposal whose action is to add or remove an Admin
  address.
- **Proposal_State**: The lifecycle state of a Proposal: `Pending`, `Approved`,
  `Executed`, `Rejected`, or `Expired`.
- **Legacy_Admin**: The single admin address stored under `DataKey::Admin`, retained
  for backward-compatible reads during the migration window.

---

## Requirements

### Requirement 1: Admin Set Management

**User Story:** As a protocol operator, I want to manage a set of admin addresses, so
that governance authority is distributed across multiple trusted parties.

#### Acceptance Criteria

1. THE Governance_System SHALL support a minimum of 1 and a maximum of 20 simultaneous
   Admin addresses.
2. WHEN the contract is initialized, THE Governance_System SHALL register the provided
   `admin` address as the first Admin and set the Admin count to 1.
3. WHEN an Admin_Management_Proposal to add a new Admin is executed, THE
   Governance_System SHALL grant `Role::Admin` to the new address and increment the
   Admin count by 1.
4. WHEN an Admin_Management_Proposal to remove an Admin is executed, THE
   Governance_System SHALL revoke `Role::Admin` from the target address and decrement
   the Admin count by 1.
5. IF an Admin_Management_Proposal to add an address that already holds `Role::Admin`
   is executed, THEN THE Governance_System SHALL return `ContractError::AlreadyAdmin`.
6. IF an Admin_Management_Proposal to remove an Admin would reduce the Admin count
   below 1, THEN THE Governance_System SHALL return
   `ContractError::InsufficientAdmins`.
7. IF an Admin_Management_Proposal to remove an Admin would reduce the Admin count
   below the configured Quorum, THEN THE Governance_System SHALL return
   `ContractError::InsufficientAdmins`.
8. THE Governance_System SHALL expose a read-only function that returns the current
   list of Admin addresses.

---

### Requirement 2: Quorum Configuration

**User Story:** As a protocol operator, I want to configure the approval quorum, so
that I can tune the security vs. operational agility trade-off.

#### Acceptance Criteria

1. WHEN the contract is initialized, THE Governance_System SHALL accept a `quorum`
   parameter in the range [1, Admin_count] and store it.
2. IF the `quorum` value provided at initialization is 0 or greater than the initial
   Admin count, THEN THE Governance_System SHALL return `ContractError::InvalidQuorum`.
3. WHEN a Proposal to update the Quorum is executed, THE Governance_System SHALL
   update the stored Quorum value.
4. IF a Proposal to update the Quorum would set it to 0 or greater than the current
   Admin count, THEN THE Governance_System SHALL return `ContractError::InvalidQuorum`.
5. THE Governance_System SHALL expose a read-only function that returns the current
   Quorum value.

---

### Requirement 3: Timelock Configuration

**User Story:** As a protocol operator, I want to configure an execution timelock, so
that stakeholders have time to react before approved proposals take effect.

#### Acceptance Criteria

1. WHEN the contract is initialized, THE Governance_System SHALL accept a
   `timelock_seconds` parameter (minimum 0) and store it.
2. THE Governance_System SHALL support a timelock of 0 seconds, meaning approved
   Proposals may be executed immediately after reaching quorum.
3. WHEN a Proposal to update the timelock is executed, THE Governance_System SHALL
   update the stored `timelock_seconds` value.
4. THE Governance_System SHALL expose a read-only function that returns the current
   `timelock_seconds` value.

---

### Requirement 4: Proposal Lifecycle

**User Story:** As an Admin, I want to create, vote on, and execute governance
proposals, so that sensitive operations require collective approval.

#### Acceptance Criteria

1. WHEN an Admin calls `propose`, THE Governance_System SHALL create a new Proposal
   with a unique monotonically increasing `proposal_id`, record the Proposer, the
   proposed action, the creation timestamp, and set Proposal_State to `Pending`.
2. IF a non-Admin address calls `propose`, THEN THE Governance_System SHALL return
   `ContractError::Unauthorized`.
3. THE Governance_System SHALL assign each Proposal a configurable expiry timestamp
   equal to the creation ledger timestamp plus a `proposal_ttl_seconds` value stored
   in contract state.
4. WHEN an Admin calls `vote` with approval on a Pending Proposal, THE
   Governance_System SHALL record that Admin's approval vote, ensuring each Admin may
   cast at most one vote per Proposal.
5. IF an Admin attempts to vote on a Proposal they have already voted on, THEN THE
   Governance_System SHALL return `ContractError::AlreadyVoted`.
6. IF a non-Admin address calls `vote`, THEN THE Governance_System SHALL return
   `ContractError::Unauthorized`.
7. WHEN the approval vote count on a Proposal reaches the configured Quorum, THE
   Governance_System SHALL transition the Proposal_State to `Approved` and record the
   approval timestamp.
8. WHEN an Admin calls `execute` on an `Approved` Proposal and the current ledger
   timestamp is greater than or equal to `approval_timestamp + timelock_seconds`, THE
   Governance_System SHALL execute the proposed action and transition Proposal_State
   to `Executed`.
9. IF `execute` is called on an `Approved` Proposal before the timelock has elapsed,
   THEN THE Governance_System SHALL return `ContractError::TimelockNotElapsed`.
10. IF `execute` is called on a Proposal that is not in `Approved` state, THEN THE
    Governance_System SHALL return `ContractError::InvalidProposalState`.
11. IF a non-Admin address calls `execute`, THEN THE Governance_System SHALL return
    `ContractError::Unauthorized`.
12. WHEN the current ledger timestamp exceeds a Proposal's expiry timestamp and the
    Proposal is still in `Pending` or `Approved` state, THE Governance_System SHALL
    allow any caller to transition the Proposal_State to `Expired` via a
    `expire_proposal` function.
13. THE Governance_System SHALL expose a read-only function that returns the full
    Proposal record for a given `proposal_id`.

---

### Requirement 5: Fee Update via Governance

**User Story:** As an Admin, I want fee changes to require multi-sig approval, so that
no single party can unilaterally alter the platform fee.

#### Acceptance Criteria

1. WHEN a Fee_Update_Proposal is executed, THE Governance_System SHALL call the
   existing fee update logic and set the platform fee to the proposed `fee_bps` value.
2. IF the proposed `fee_bps` in a Fee_Update_Proposal exceeds `MAX_FEE_BPS` (10000),
   THEN THE Governance_System SHALL return `ContractError::InvalidFeeBps` at proposal
   creation time.
3. THE Governance_System SHALL emit a `FeeUpdateProposed` event when a
   Fee_Update_Proposal is created, including `proposal_id` and `fee_bps`.
4. THE Governance_System SHALL emit a `FeeUpdated` event (existing event) when a
   Fee_Update_Proposal is executed.
5. WHILE a Fee_Update_Proposal is in `Pending` or `Approved` state, THE
   Governance_System SHALL allow at most one active Fee_Update_Proposal at a time,
   returning `ContractError::ProposalAlreadyPending` if a second is submitted.

---

### Requirement 6: Agent Management via Governance

**User Story:** As an Admin, I want agent registration and removal to require multi-sig
approval, so that no single party can unilaterally add or remove payout agents.

#### Acceptance Criteria

1. WHEN an Agent_Management_Proposal to register an agent is executed, THE
   Governance_System SHALL call the existing agent registration logic, setting the
   agent as registered and assigning `Role::Settler`.
2. WHEN an Agent_Management_Proposal to remove an agent is executed, THE
   Governance_System SHALL call the existing agent removal logic, clearing the
   registered flag and revoking `Role::Settler`.
3. IF the target address in an Agent_Management_Proposal to register is already a
   registered agent, THEN THE Governance_System SHALL return
   `ContractError::AgentAlreadyRegistered` at proposal creation time.
4. IF the target address in an Agent_Management_Proposal to remove is not a registered
   agent, THEN THE Governance_System SHALL return `ContractError::AgentNotRegistered`
   at proposal creation time.
5. THE Governance_System SHALL emit an `AgentManagementProposed` event when an
   Agent_Management_Proposal is created, including `proposal_id`, `agent`, and
   `action` (register or remove).
6. THE Governance_System SHALL emit the existing `AgentRegistered` or `AgentRemoved`
   event when an Agent_Management_Proposal is executed.

---

### Requirement 7: Backward Compatibility and Migration

**User Story:** As a protocol operator, I want the governance upgrade to be backward
compatible, so that existing integrations continue to function during the transition.

#### Acceptance Criteria

1. THE Governance_System SHALL retain the `DataKey::Admin` (Legacy_Admin) storage
   entry and continue to return it from `get_admin` for read-only callers.
2. WHEN the first Admin_Management_Proposal to add a new Admin is executed, THE
   Governance_System SHALL update the Legacy_Admin entry to the address of the
   Proposer of that proposal, preserving a valid single-admin reference.
3. THE Governance_System SHALL provide a one-time `migrate_to_governance` function
   callable only by the Legacy_Admin that sets the initial Quorum and
   `timelock_seconds` without requiring a Proposal, enabling upgrade from the existing
   single-admin deployment.
4. IF `migrate_to_governance` is called after governance has already been initialized,
   THEN THE Governance_System SHALL return `ContractError::AlreadyInitialized`.
5. WHILE the contract is in single-admin mode (Admin count = 1 and Quorum = 1), THE
   Governance_System SHALL allow the sole Admin to execute proposals immediately
   without waiting for additional votes, preserving existing operational behavior.

---

### Requirement 8: Event Emission

**User Story:** As an off-chain integrator, I want governance events emitted for all
state changes, so that I can track proposal lifecycle and audit governance actions.

#### Acceptance Criteria

1. THE Governance_System SHALL emit a `ProposalCreated` event when any Proposal is
   created, including `proposal_id`, `proposer`, `action_type`, and `expiry`.
2. THE Governance_System SHALL emit a `ProposalVoted` event when an Admin votes,
   including `proposal_id`, `voter`, and `approval_count`.
3. THE Governance_System SHALL emit a `ProposalApproved` event when a Proposal
   transitions to `Approved` state, including `proposal_id` and `approval_timestamp`.
4. THE Governance_System SHALL emit a `ProposalExecuted` event when a Proposal is
   executed, including `proposal_id` and `executor`.
5. THE Governance_System SHALL emit a `ProposalExpired` event when a Proposal is
   transitioned to `Expired` state, including `proposal_id`.
6. THE Governance_System SHALL emit an `AdminAdded` event when a new Admin is added,
   including the new `admin` address and `proposal_id`.
7. THE Governance_System SHALL emit an `AdminRemoved` event when an Admin is removed,
   including the removed `admin` address and `proposal_id`.

---

### Requirement 9: Security and Authorization Invariants

**User Story:** As a security auditor, I want the governance system to enforce strict
authorization invariants, so that no unauthorized party can influence governance
outcomes.

#### Acceptance Criteria

1. THE Governance_System SHALL require `address.require_auth()` from the caller for
   all state-mutating governance functions (`propose`, `vote`, `execute`,
   `expire_proposal`, `migrate_to_governance`).
2. IF any state-mutating governance function is called by an address that does not
   hold `Role::Admin`, THEN THE Governance_System SHALL return
   `ContractError::Unauthorized`.
3. THE Governance_System SHALL prevent replay of an already-`Executed` Proposal by
   returning `ContractError::InvalidProposalState` on any subsequent `execute` call.
4. THE Governance_System SHALL prevent a single Admin from approving a Proposal more
   than once, regardless of how many times `vote` is called.
5. FOR ALL Proposals, the total approval vote count SHALL never exceed the current
   Admin count.
6. THE Governance_System SHALL reject any `propose` call made while the contract is
   paused (circuit breaker active), returning `ContractError::ContractPaused`.
