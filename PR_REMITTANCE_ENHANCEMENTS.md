# Pull Request: Remittance V2 Enhancements

## Summary
This PR implements three major features to enhance the SwiftRemit ecosystem: Multi-currency support, a formal Dispute Resolution Mechanism, and an Agent Reputation Scoring system.

## Features Implemented

### 1. Multi-currency Support (Closes #257)
- **Token Agnostic Escrow**: Updated `create_remittance` to accept an optional `token: Address` parameter.
- **Whitelist Validation**: Integrated checks to ensure only admin-whitelisted tokens are accepted for remittance creation.
- **Token-Aware Payouts**: The contract now tracks the specific token address for each remittance, ensuring payouts and refunds use the correct asset.
- **Tests**: Added coverage for standard USDC and a secondary mock token flow.

### 2. Dispute Resolution Mechanism (Closes #256)
- **Failed Payout Flow**: Agents can now call `mark_failed` if a fiat payout cannot be completed, which captures the timestamp and halts processing.
- **Dispute Window**: Senders have a configurable window (defaulting to 48 hours) to call `raise_dispute` after a failure, providing a cryptographic hash of evidence.
- **Admin Resolution**: Admins can review disputes and call `resolve_dispute`.
    - **In favor of Sender**: Full refund of the escrowed tokens.
    - **In favor of Agent**: Settlement proceeds normally (fee deduction + agent payout).
- **Lifecycle Updates**: Added `Failed` and `Disputed` states to the canonical remittance state machine.

### 3. Agent Reputation Scoring (Closes #255)
- **Persistence**: Added `AgentStats` storage to track performance metrics per agent.
- **Metrics**: Tracks `total_settlements`, `failed_settlements`, and cumulative `total_settlement_time`.
- **Atomic Updates**: Stats are updated automatically during `confirm_payout` (success/time) and `mark_failed` (failure).
- **Query Function**: Added `get_agent_stats(agent: Address)` to allow users to verify agent reliability before sending funds.

## Files Changed
- `src/lib.rs`: Added new public entry points and logic updates.
- `src/types.rs`: Expanded `Remittance` and `RemittanceStatus`; added `AgentStats`.
- `src/storage.rs`: Added reputation and dispute window persistence helpers.
- `src/errors.rs`: Defined error codes for dispute expirations and invalid states.
- `src/events.rs`: Added events for dispute raising, resolution, and failed payouts.
- `README.md`: Updated the roadmap status.

## Verification
- [x] `cargo test` passes with new unit tests.
- [x] Atomic rollback verified for multi-token logic.
- [x] Dispute window enforcement verified with ledger timestamp manipulation.
- [x] Reputation scores correctly increment across multiple settlement cycles.

Ready for review! 🚀