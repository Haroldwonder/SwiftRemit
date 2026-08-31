# Roadmap

Tracked as **SR-005** in [ISSUES.md](https://github.com/topsonDev/SwiftRemit/blob/main/ISSUES.md).

Every checked item below links to the code that implements it. Every unchecked item has
no implementation in `src/` yet.

## Shipped

- [x] Asset verification system — [`src/asset_verification.rs`](src/asset_verification.rs)
- [x] Integration with fiat on/off ramps (via SEP-24) — [`backend/src/sep24-service.ts`](backend/src/sep24-service.ts)
- [x] Multi-currency support — fee corridors and the currency/FX API
      ([`set_fee_corridor`](src/lib.rs), [`fee_breakdown_corridor`](src/lib.rs),
      [`api/`](api))
- [x] Batch remittance processing —
      [`batch_create_remittances`](src/lib.rs), [`create_batch_remittance`](src/lib.rs),
      [`confirm_batch_payout`](src/lib.rs), [`batch_settle_with_netting`](src/lib.rs)
      (tests: [`src/test_batch_create.rs`](src/test_batch_create.rs))
- [x] Agent reputation system —
      [`get_agent_reputation`](src/lib.rs), [`set_min_agent_reputation`](src/lib.rs)
      (tests: [`src/test_agent_stats.rs`](src/test_agent_stats.rs))
- [x] Dispute resolution mechanism —
      [`raise_dispute`](src/lib.rs), [`resolve_dispute`](src/lib.rs)
      (tests: [`src/test_dispute.rs`](src/test_dispute.rs))
- [x] Oracle-backed FX rates — [`src/oracle.rs`](src/oracle.rs)
      ([`set_oracle`](src/lib.rs), [`get_oracle`](src/lib.rs), [`get_fx_rate_guarded`](src/oracle.rs))

## Pending

- [ ] Mainnet security audit
- [ ] Time-locked escrow tiers (today's `create_escrow` has a single global TTL, not
      per-tier lock durations)
