# PR Description: #261 Contract Upgrade / Migration Authorization with Timelock

## Summary

Implements secure contract upgrade authorization requiring multi-signature approval from admins and mandatory 48-hour timelock before execution.

## Issue Reference

- Issue: #261 - Implement contract upgrade / migration authorization with timelock
- Priority: High
- Security Focus

## Problem

Soroban contracts can be upgraded via `env.deployer().update_current_contract_wasm()`. With no authorization mechanism, a compromised admin key could silently replace all contract logic.

## Solution

Create upgrade module with:
- **M-of-N multi-sig**: Requires majority admin approval before execution
- **48-hour timelock**: Mandatory delay after approval before execution possible
- **Events**: UpgradeProposed, UpgradeApproved, UpgradeExecuted for transparency

## Changes

### New Files

1. **src/contract_upgrade.rs** - Core upgrade module
   - `propose_upgrade(caller, wasm_hash)` - Create upgrade proposal
   - `approve_upgrade(caller, proposal_id)` - Admin approval 
   - `execute_upgrade(caller, proposal_id)` - Execute after timelock
   - `cancel_upgrade(caller, proposal_id)` - Cancel pending
   - Storage for proposals with indexes

2. **src/test_contract_upgrade.rs** - Unit tests
   - Proposal creation
   - Multi-sig approval
   - Timelock enforcement
   - Event emission

### Configuration

```rust
// Constants
pub const TIMELOCK_SECONDS: u64 = 48 * 60 * 60;  // 48 hours
pub const MIN_ADMINS_FOR_UPGRADE: u32 = 3;
pub const MAX_PENDING_UPGRADES: u32 = 5;
```

## API

### Propose Upgrade

```rust
// Requires admin auth
let proposal_id = contract.propose_upgrade(&admin, &new_wasm_hash);
// Returns unique proposal_id
```

### Approve Upgrade

```rust
// Each admin can approve once
// After M approvals (M = admin_count/2+1), timelock starts
contract.approve_upgrade(&admin2, &proposal_id);
```

### Execute Upgrade

```rust
// Only succeeds after 48h timelock expires
contract.execute_upgrade(&admin, &proposal_id);
```

## Events Emitted

| Event | Fields | Description |
|-------|--------|-------------|
| UpgradeProposed | proposal_id, wasm_hash | New upgrade proposed |
| UpgradeApproved | proposal_id, approval_count | Approval received |
| UpgradeExecuted | proposal_id | Upgrade executed |

## Acceptance Criteria

- [x] Upgrade proposal requires multi-sig (M-of-N)
- [x] 48-hour timelock enforced via ledger timestamp
- [x] UpgradeProposed and UpgradeExecuted events emitted
- [x] Unit tests cover: proposal, timelock enforcement, execution
- [x] Security model documented

## Security Model

1. **Proposal**: Any admin can propose
2. **Approval**: Requires majority of admins (M-of-N where M = floor(N/2)+1)
3. **Timelock**: Begins after quorum reached, 48 hours minimum
4. **Execution**: Only after timelock expires

### Attack Scenarios Prevented

- Single admin compromise: Cannot execute alone (needs M-of-N)
- Timelock gives 48h to detect and cancel suspicious upgrades
- All actions logged on-chain for audit

## Testing

```bash
cargo test test_contract_upgrade
```

## Breaking Changes

- None (new functions added)
- Existing contract functions unchanged

## Related Issues

- #260 - Webhook HMAC Security
- #161 - Overall Security Model