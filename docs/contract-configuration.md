# Smart-contract runtime configuration

This is the reference for SwiftRemit's contract runtime parameters. It describes the public setters in `src/lib.rs` and their associated storage/configuration modules. Values marked **initialization input** are chosen at deployment; they are not hard-coded defaults. A dash in the event column means the public setter does **not explicitly emit a configuration event**.

**Units:** basis points (bps) are hundredths of a percent (100 bps = 1%); durations are seconds unless marked as ledgers; token amounts are contract integer/stroop amounts. A `u64` argument is limited by its type even where no smaller validation bound is imposed.

## Admin-configurable parameters

| Configuration / public setter | Initial/default value | Allowed values and constraints | Who can change it | Emitted event |
| --- | --- | --- | --- | --- |
| Platform fee — `update_fee(fee_bps)` | `fee_bps` supplied to `initialize` | 0–10,000 bps inclusive; also resets fee strategy to `Percentage(fee_bps)` | Contract admin | `fee_updated` |
| Protocol fee — `update_protocol_fee(caller, fee_bps)` | `protocol_fee_bps` supplied to `initialize` | 0–200 bps | Contract admin | `protocol_fee_updated` |
| Token-specific fee — `update_token_fee(caller, token, fee_bps)` | No override until configured | 0–10,000 bps; token must be whitelisted | Contract admin | `token_fee_updated` |
| Fee strategy — `update_fee_strategy(caller, strategy)` | `Percentage(fee_bps)` at initialization | `Percentage(bps)`, `Flat(amount)`, or `Dynamic(bps)`; the setter has no additional validation at entry | Contract admin | None |
| Corridor fee — `set_fee_corridor(caller, corridor)` / `remove_fee_corridor(caller, from_country, to_country)` | No corridor overrides | `FeeCorridor` values keyed by source/destination country; no additional bound checked in these entry points | Contract admin | None |
| Treasury — `update_treasury(caller, treasury)` | `treasury` supplied to `initialize` | Address (no extra bound at entry point) | Contract admin | `treasury_updated` |
| Dispute window — `set_dispute_window(seconds)` | 259,200 (72 hours) | 0–2,592,000 (30 days) | Contract admin | `config_updated` (`disp_win`) |
| Processing recovery timeout — `set_processing_timeout(seconds)` | 604,800 (7 days) in the processing-recovery storage default | `u64` seconds; no extra bound in entry point | Contract admin | None |
| Global escrow TTL — `update_escrow_ttl(ttl)` | 0 (no expiry) | 0 through `u64::MAX - 1`; `u64::MAX` rejected | Contract admin | `config_updated` (`esc_ttl`) |
| Legacy rate-limit cooldown — `update_rate_limit(cooldown_seconds)` | `rate_limit_cooldown` supplied to `initialize` | `u64` seconds; no extra upper bound | Contract admin | `config_updated` (`rate_lim`) |
| Sliding rate-limit configuration — `update_rate_limit_config(caller, max_requests, window_seconds, enabled)` | 100 requests / 60 seconds / enabled | `u32` request count, `u64` window, boolean enabled; no extra input bounds in entry point | Contract admin | None |
| Daily sender limit — `set_daily_limit(currency, country, limit)` / `remove_daily_limit(currency, country)` | Unset (unlimited per corridor) | Strictly positive `i128` limit; remove clears override; rolling 86,400-second window | Contract admin | `daily_limit_updated` / `daily_limit_removed` |
| Per-agent daily withdrawal cap — `set_agent_daily_cap(agent, cap)` | 0 (uncapped) | Nonnegative `i128`; 0 disables cap; rolling 86,400-second window | Contract admin | `agent_cap_set` |
| Minimum agent reputation — `set_min_agent_reputation(threshold)` | 0 | 0–100 inclusive | Contract admin | `config_updated` (`min_rep`) |
| Oracle address and staleness — `set_oracle(caller, oracle, staleness_window_ledgers)` | No oracle; default staleness 360 ledgers | Valid external oracle address; optional `u32` ledger window; 0 means keep current/default, positive values update | Contract admin | None |
| Pause timelock — `set_pause_timelock(caller, seconds)` | 0 | 0–604,800 (7 days) | Account with Admin role | None |
| Unpause quorum — `set_unpause_quorum(caller, quorum)` | 1 | 1 through current number of admins | Account with Admin role | None |
| Post-unpause cooldown — `set_cooldown_period(caller, seconds)` | 3,600 (1 hour) | 0–604,800; 0 disables post-unpause throttling | Account with Admin role | None |
| Expired-remittance batch maximum — `set_max_expired_batch_size(size)` | 50 | 1–200 inclusive | Contract admin | `config_updated` (`exp_batch`) |
| Multisig threshold / pending-operation TTL — `set_multisig_config(caller, threshold, ttl_seconds)` or `propose_multisig_config(...)` | Threshold 1; TTL 86,400 | Threshold at least 1; when current threshold exceeds 1, updates require a quorum-approved proposal | Contract admin / multisig approvals | Managed by multisig operation events; see `src/multisig.rs` |
| Governance quorum, timelock, proposal TTL — `migrate_to_governance(caller, quorum, timelock_seconds, proposal_ttl_seconds)`; subsequent governance proposals | Not configured before governance migration | Values validated by governance implementation; one-time migration is legacy-admin-only; later changes require proposal/vote/execute | Legacy admin (migration); governance thereafter | Governance proposal/vote/execution events |

### Important distinctions

- The `set_processing_timeout` public entry point currently refers to `storage::set_processing_timeout`, while the storage configuration reference uses `set_processing_recovery_timeout` and a **7-day fallback**. This document reports the storage default without changing or silently repairing that naming inconsistency.
- `set_oracle` updates storage, but consuming oracle rates as part of remittance creation is feature-gated (`oracle`). If no oracle is configured, the documented off-chain FX path is retained.
- `set_fee_corridor`, fee strategies, `set_oracle`, and other setters without emitted events should not be assumed to emit `config_updated`. Do not rely on a nonexistent event when indexing changes.
- The legacy `pause()` / `unpause()` entry points bypass the enhanced circuit-breaker checks; `emergency_unpause()` and `vote_unpause()` enforce the quorum/timelock flow. The pause configuration above applies to the enhanced path.

## Role and membership controls

These are administrative controls rather than numeric parameters. They are included to identify who can change runtime authorizations.

| Operation | Initial/default | Bounds / authorization | Event |
| --- | --- | --- | --- |
| `register_agent(agent, kyc_hash)` / `remove_agent(agent)` | No registered agent by default | Contract admin only | `agent_registered` / `agent_removed` |
| `add_whitelisted_token(token)` / `remove_whitelisted_token(token)` | Configured token is set during initialization | Contract admin; tokens cannot be added twice or removed when absent | `token_whitelisted` / token-removed event |
| `assign_role(caller, address, role)` / `remove_role(...)` | Roles set during initialization | Authorized account with Admin role | None in entry points |
| Admin transfer proposals / acceptance | Initial admin set during deployment | Controlled admin transfer; proposed successor must accept | Admin-transfer events |
| `emergency_pause`, `emergency_unpause`, `vote_unpause` | Not paused | Admin role; enhanced unpause subject to configured timelock/quorum | Circuit-breaker pause/unpause/vote events |

## Fixed limits (not admin-tunable at runtime)

These are source-code constants, **not** admin setter values. Altering them requires a contract code change or upgrade.

| Limit | Current constant |
| --- | --- |
| General settlement / payout batch maximum | `MAX_BATCH_SIZE = 100` |
| Expired-remittance default compiled maximum | `MAX_EXPIRED_BATCH_SIZE = 50` (the separate runtime setter allows 1–200 for the relevant expiry path) |
| Migration import/export batch maximum | `MAX_MIGRATION_BATCH_SIZE = 100` |
| Netting batch maximum | `MAX_NETTING_BATCH_SIZE = 50` |
| KYC batch constant | `MAX_KYC_BATCH_SIZE = 100` in `src/config.rs` (check the specific call site; `src/lib.rs` also defines a local value of 50) |
| Remittance records page maximum | `MAX_REMITTANCE_PAGE_SIZE = 100` |
| Abuse-control window | 60 seconds |
| Transfers / cancellations / queries per abuse-control window | 10 / 5 / 100 |
| Abuse-control transfer cooldown | 5 seconds |
| Sender daily-limit window / agent cap window | 86,400 seconds each |

## Reading the current configuration

Use `get_config()` to read a consolidated contract configuration snapshot, and the corresponding `get_*` functions for individual values. A freshly deployed contract may have initialization-specific fees, treasury, and legacy cooldown values: do not treat those as universal hard-coded defaults.

Source references: [`src/lib.rs`](../src/lib.rs), [`src/config.rs`](../src/config.rs), [`src/storage.rs`](../src/storage.rs), [`src/rate_limit.rs`](../src/rate_limit.rs), [`src/oracle.rs`](../src/oracle.rs), and [`src/events.rs`](../src/events.rs).
