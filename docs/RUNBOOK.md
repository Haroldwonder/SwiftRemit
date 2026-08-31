# SwiftRemit Operational Runbook

On-call reference for common production procedures. All `stellar contract invoke` commands assume the following environment variables are set:

```bash
export CONTRACT_ID=<deployed_contract_id>
export NETWORK=mainnet          # or testnet
export RPC_URL=<soroban_rpc_url>
export ADMIN_IDENTITY=<your_admin_identity_name>
```

---

## 1. Emergency Pause

Use when a security incident, suspicious activity, or external threat requires halting all contract operations immediately.

**Pause reasons:** `SecurityIncident` | `SuspiciousActivity` | `MaintenanceWindow` | `ExternalThreat`

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  emergency_pause \
  --caller $ADMIN_ADDRESS \
  --reason SecurityIncident
```

Verify the pause took effect:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  health
```

Confirm `paused: true` and `pause_reason` matches the reason supplied.

**After pausing:**
- Post an incident notice in the team Slack channel (`#incidents`).
- Open a GitHub issue tagged `incident` with the pause reason and ledger sequence.
- The frontend `ContractHealth` widget will automatically display the pause banner to users within 60 seconds.

---

## 2. Circuit Breaker: Multi-Admin Vote-to-Unpause

The circuit breaker is a quorum-gated safety mechanism that prevents a single compromised admin from unilaterally resuming contract operations after an emergency pause. All three phases below must be completed in order.

### Phase 1 — Trigger the emergency pause

Any single admin can pause immediately (see **Section 1** for the full procedure):

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  emergency_pause \
  --caller $ADMIN_ADDRESS \
  --reason SecurityIncident
```

Notify all other admins in `#incidents` immediately so they can participate in the quorum vote.

### Phase 2 — Coordinate the vote-to-unpause quorum

**Check current quorum state** (run this before and after each vote):

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  health
```

Inspect the response for:
- `paused: true` — confirms the pause is active
- `pause_votes` — number of admins who have already voted to unpause
- `required_votes` — quorum threshold that must be reached
- `timelock_remaining` — seconds remaining before the timelock expires (must reach 0 before unpause is accepted)

**Each admin must cast a vote independently:**

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  vote_unpause \
  --caller $ADMIN_ADDRESS
```

Repeat this command for every admin until `pause_votes >= required_votes`. Once quorum is reached **and** the timelock has elapsed, the contract unpauses automatically.

**Tracking votes during a live incident:**

1. Designate one admin as incident commander to collect confirmation messages in `#incidents`.
2. Each admin posts their `ADMIN_ADDRESS` and transaction hash after voting.
3. The incident commander re-runs the `health` query after each vote to confirm `pause_votes` increments.
4. Do not proceed to Phase 3 until `pause_votes >= required_votes` is confirmed in `health` output.

### Phase 3 — Emergency unpause (last resort only)

Use `emergency_unpause` **only** when:
- Quorum cannot be reached (e.g., admins are unreachable), **and**
- The situation requires immediate contract resumption to prevent greater harm, **and**
- A post-incident review will be conducted to address the quorum failure.

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  emergency_unpause \
  --caller $ADMIN_ADDRESS
```

> **Warning:** `emergency_unpause` bypasses quorum. It should be treated as a break-glass action. Document the justification in the incident GitHub issue before executing.

Verify the contract is running normally after either path:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  health
```

Confirm `paused: false` and `pause_votes: 0` (votes are cleared on unpause).

**After completing the circuit breaker procedure:**
- Close the incident GitHub issue with a summary of which path was taken (quorum or last-resort).
- Post a resolution notice in `#incidents` including the ledger sequence of the unpause.
- If `emergency_unpause` was used, open a follow-up issue tagged `security-review` to evaluate whether the admin quorum configuration needs adjustment.

---

## 3. Unpause After Incident Resolution

Unpausing requires admin quorum votes (default: 1). If a timelock is configured, the elapsed time since the pause must exceed `timelock_seconds` before the unpause is accepted.

**Step 1 — each admin casts a vote:**

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  vote_unpause \
  --caller $ADMIN_ADDRESS
```

Once quorum is reached the contract unpauses automatically. If quorum is already met and the timelock has elapsed, any admin can trigger the unpause directly:

**Step 2 (optional direct unpause after quorum + timelock):**

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  emergency_unpause \
  --caller $ADMIN_ADDRESS
```

Verify:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  health
```

Confirm `paused: false`.

**After unpausing:**
- Close the incident GitHub issue.
- Post a resolution notice in `#incidents` with the ledger sequence of the unpause.

---

## 4. Rotate Admin Keys via Governance Proposal

Admin key rotation uses the on-chain governance module. The process is: propose → vote → execute (after timelock).

**Step 1 — propose adding the new admin:**

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  propose \
  --proposer $CURRENT_ADMIN_ADDRESS \
  --action '{"AddAdmin": "<NEW_ADMIN_ADDRESS>"}'
```

Note the returned `proposal_id`.

**Step 2 — each admin votes to approve:**

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  vote \
  --voter $ADMIN_ADDRESS \
  --proposal_id <PROPOSAL_ID>
```

**Step 3 — execute after timelock elapses:**

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  execute \
  --executor $ADMIN_ADDRESS \
  --proposal_id <PROPOSAL_ID>
```

**Step 4 — remove the old admin key (repeat steps 1–3 with `RemoveAdmin`):**

```bash
# Propose removal
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  propose \
  --proposer $NEW_ADMIN_ADDRESS \
  --action '{"RemoveAdmin": "<OLD_ADMIN_ADDRESS>"}'
```

Vote and execute as above. Verify with:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  get_admin_count
```

---

## 5. Handle a Stuck Migration

A migration can become stuck if a batch import fails mid-flight or the contract is paused during migration.

**Check current migration state:**

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  export_state
```

Inspect `schema_version` and whether a rollback snapshot exists.

**Option A — abort and reset to Idle:**

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  abort_migration \
  --caller $ADMIN_ADDRESS
```

This emits a `mig.aborted` event and resets migration state. The contract returns to normal operation.

**Option B — rollback to pre-migration snapshot:**

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  rollback_migration
```

After rollback, verify the schema version has reverted and re-run the migration from batch 0.

**Resuming a partial batch migration:**

If only some batches were imported, resume from the next expected batch number (visible in the stuck state export):

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  import_batch \
  --batch '<BATCH_JSON>'
```

---

## 6. Replay Failed Webhook Deliveries

The webhook dispatcher persists delivery attempts in the `webhook_deliveries` table. Failed deliveries can be replayed via the backend admin API.

**List failed deliveries (last 100):**

```bash
psql $DATABASE_URL -c "
  SELECT id, event_type, anchor_id, created_at, attempt_count, last_error
  FROM webhook_deliveries
  WHERE status = 'failed'
  ORDER BY created_at DESC
  LIMIT 100;
"
```

**Replay a single delivery:**

```bash
curl -X POST http://localhost:3001/admin/webhooks/replay \
  -H 'Content-Type: application/json' \
  -d '{"delivery_id": "<DELIVERY_ID>"}'
```

**Replay all failed deliveries for an anchor:**

```bash
curl -X POST http://localhost:3001/admin/webhooks/replay-anchor \
  -H 'Content-Type: application/json' \
  -d '{"anchor_id": "<ANCHOR_ID>", "status": "failed"}'
```

**Replay dispute events specifically** (if `dispute_raised` or `dispute_resolved` deliveries failed):

```bash
psql $DATABASE_URL -c "
  SELECT id FROM webhook_deliveries
  WHERE event_type IN ('dispute_raised', 'dispute_resolved')
    AND status = 'failed';
" | xargs -I{} curl -X POST http://localhost:3001/admin/webhooks/replay \
  -H 'Content-Type: application/json' \
  -d '{"delivery_id": "{}"}'
```

Monitor delivery status:

```bash
psql $DATABASE_URL -c "
  SELECT status, count(*) FROM webhook_deliveries GROUP BY status;
"
```

---

## 7. Extend Contract Storage TTL

Soroban persistent storage entries expire after a set number of ledgers. Extend TTL before entries expire to avoid data loss.

**Check current TTL for a remittance entry:**

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  get_remittance \
  --remittance_id <ID>
```

**Extend TTL via Stellar CLI (bump ledgers):**

```bash
stellar contract extend \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  --ledgers-to-extend 500000 \
  --durability persistent
```

For individual storage keys (e.g., a specific remittance):

```bash
stellar contract extend \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  --key '{"Remittance": <ID>}' \
  --ledgers-to-extend 500000 \
  --durability persistent
```

Recommended: run a scheduled job (weekly) to bump TTL on all active remittances before they approach expiry. The `process_expired_remittances` function handles logical expiry; this procedure handles Soroban storage-level TTL.

---

## 8. Rotate ADMIN_SECRET_KEY (Service-Level Key)

The `ADMIN_SECRET_KEY` environment variable holds the Stellar keypair used by `backend/src/stellar.ts` to sign Soroban transactions. Because it lives in an environment variable, a compromised key cannot be revoked without a service redeployment. Follow this procedure to rotate it safely.

### Recommended: Use a Secrets Manager

Store `ADMIN_SECRET_KEY` in **AWS Secrets Manager** or **HashiCorp Vault** instead of a plain environment variable. Both support automatic rotation and instant revocation without redeployment:

- **AWS Secrets Manager**: create a secret of type `Other`, enable automatic rotation with a Lambda rotator, and inject the value at runtime via the AWS SDK or the ECS/EKS secrets injection mechanism.
- **HashiCorp Vault**: use the `transit` or `kv-v2` secret engine; rotate with `vault kv put` and have the service read the secret at startup via the Vault Agent sidecar or SDK.

### Manual Rotation Procedure

**Step 1 — generate a new Stellar keypair:**

```bash
stellar keys generate new-admin --network mainnet
stellar keys address new-admin   # note the new public key
```

**Step 2 — authorize the new key on-chain** (add it as an admin via governance; see Section 3):

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  propose \
  --proposer $CURRENT_ADMIN_ADDRESS \
  --action '{"AddAdmin": "<NEW_ADMIN_PUBLIC_KEY>"}'
# vote and execute as described in Section 3
```

**Step 3 — update the secret in your secrets manager or deployment config:**

```bash
# AWS Secrets Manager example
aws secretsmanager put-secret-value \
  --secret-id swiftremit/admin-secret-key \
  --secret-string '{"ADMIN_SECRET_KEY":"<new_secret_key>"}'
```

**Step 4 — redeploy or restart the backend service** so it picks up the new key.

**Step 5 — revoke the old key on-chain** (RemoveAdmin via governance; see Section 3):

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  propose \
  --proposer $NEW_ADMIN_ADDRESS \
  --action '{"RemoveAdmin": "<OLD_ADMIN_PUBLIC_KEY>"}'
# vote and execute as described in Section 3
```

**Step 6 — verify** the old key no longer has admin rights:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  get_admin_count
```

Confirm the count reflects only the new key. Post a rotation notice in `#incidents` with the ledger sequence of the RemoveAdmin execution.

---

## 9. API Availability SLO Burn

**Alerts:** `SwiftRemitAvailabilityBudgetBurnFast` (critical), `SwiftRemitAvailabilityBudgetBurnSlow` (warning), `SwiftRemitAvailabilityBudgetExhausted` (warning)

**Objective:** 99.9% of API requests return a non-5xx status over a rolling 30 days (error budget: ~43 minutes per month).

1. Identify what is failing:
   ```promql
   topk(5, sum by (route, status) (rate(swiftremit_http_requests_total{status=~"5.."}[5m])))
   ```
2. Check whether the errors are concentrated in one route. A single failing route usually means a downstream dependency — cross-check `swiftremit_anchor_availability`, `swiftremit_circuit_open` and `db_pool_waiting_connections`.
3. If errors are spread across every route, look at the database first (`/health/db` on the backend) and then the most recent deploy.
4. Roll back the most recent deploy if the burn started within 15 minutes of it.
5. If the budget is exhausted, freeze non-essential deploys until the 30-day window rolls over and open a post-mortem.

**Dashboard:** Grafana → SwiftRemit / API (latency, errors, error-budget burn).

---

## 10. API Latency SLO Burn

**Alert:** `SwiftRemitLatencyBudgetBurnFast` (warning)

**Objective:** 99% of API requests complete in under 500 ms over a rolling 30 days.

1. Find the slow routes:
   ```promql
   histogram_quantile(0.95, sum by (le, route) (rate(swiftremit_http_request_duration_seconds_bucket[5m])))
   ```
2. Check connection-pool pressure — `db_pool_waiting_connections > 0` almost always shows up as latency before it shows up as errors. See [17. Database Connection Pool Saturation](#17-database-connection-pool-saturation).
3. Check whether an upstream anchor or the FX provider is slow (`swiftremit_anchor_availability{status="degraded"}`, `swiftremit_circuit_open`).
4. Scale the API deployment if CPU is saturated — the HPA targets 65% in production, so sustained saturation means the maximum replica count is too low.

---

## 11. Remittance Settlement Time SLO Breach

**Alert:** `SwiftRemitSettlementTimeSLOBreached` (warning)

**Objective:** 95% of remittances settle within 15 minutes.

1. Confirm the breach is real and not a single outlier:
   ```promql
   swiftremit_settlement_seconds_p95
   swiftremit_oldest_pending_remittance_age_seconds
   ```
2. Identify the corridor. Slow settlement is nearly always anchor-side — check [14. Anchor Unavailable or Circuit Open](#14-anchor-unavailable-or-circuit-open).
3. Check the contract event indexer lag: a lagging indexer delays the settlement confirmation even when the chain has already settled.
4. If a specific anchor is responsible, disable it for new remittances (`SEP24_ENABLED_<ANCHOR_ID>=false`) and let in-flight transactions drain.
5. Notify support so senders whose transfers are late are told proactively.

---

## 12. Remittance Stuck in a Non-Terminal State

**Alerts:** `SwiftRemitOldestPendingRemittanceStuck` (critical), `SwiftRemitOldestPendingRemittanceStuckWarning` (warning)

Sender funds are in escrow and the recipient has not been paid. Treat the critical variant as P0.

1. Find the stuck transactions:
   ```sql
   SELECT transaction_id, anchor_id, status, created_at, updated_at, message
     FROM transactions
    WHERE status NOT IN ('completed', 'refunded', 'error', 'expired')
    ORDER BY created_at
    LIMIT 20;
   ```
2. Group by `status` and `anchor_id` — one dominant pair points straight at the cause:
   - `pending_anchor` → the anchor has not moved the transaction. See [14. Anchor Unavailable or Circuit Open](#14-anchor-unavailable-or-circuit-open).
   - `submitted` → the Stellar transaction may not have been confirmed. Check the contract event indexer lag.
   - `pending` with no anchor activity → check that background jobs are running. See [16. Background Job Failing or Stalled](#16-background-job-failing-or-stalled).
3. Verify the contract is not paused (`swiftremit_contract_paused`). If it is, go to [2. Circuit Breaker: Multi-Admin Vote-to-Unpause](#2-circuit-breaker-multi-admin-vote-to-unpause).
4. For transactions past `ANCHOR_TIMEOUT_HOURS`, the timeout job marks them `error` and they become refundable. Confirm that job ran.
5. Refund only after confirming on-chain state with the reconciler — never refund while [13. On-Chain State Divergence](#13-on-chain-state-divergence) is firing.

---

## 13. On-Chain State Divergence

**Alerts:** `SwiftRemitStateDivergence` (critical), `SwiftRemitReconcilerStalled` (warning), `SwiftRemitContractEventIndexerLag` (warning)

The database and the contract disagree about remittance state. Balances shown to users may be wrong.

1. **Stop all refunds and payouts.** Acting on a diverged view can pay out twice.
2. Inspect the reconciler metrics:
   ```promql
   reconciler_divergences_total
   reconciler_divergences_repaired_total
   reconciler_consecutive_divergent_cycles
   reconciler_ledger_gaps_detected_total
   ```
3. If `reconciler_ledger_gaps_detected_total` is climbing, the indexer missed ledgers — the reconciler backfills them; give it two cycles before intervening.
4. If divergence persists after three cycles, the repair path is failing. Pull the reconciler logs and identify the specific remittance IDs.
5. Treat the chain as the source of truth. Correct the database to match the contract, never the other way round.
6. If the indexer is simply behind (`contract_event_indexer_lag_ledgers > 100`), check the Soroban RPC endpoint health and restart the indexer; no data is lost, it replays from the last indexed ledger.

---

## 14. Anchor Unavailable or Circuit Open

**Alerts:** `SwiftRemitAnchorCircuitOpen` (critical), `SwiftRemitAnchorDegraded` (warning)

1. Confirm which anchor and for how long:
   ```promql
   swiftremit_anchor_availability
   ```
2. Probe the anchor's SEP-24 endpoint directly and check its `stellar.toml` is still reachable.
3. Check the anchor's own status page before assuming it is our side.
4. Stop routing new remittances to the anchor:
   ```bash
   SEP24_ENABLED_<ANCHOR_ID>=false   # then restart the backend
   ```
5. Let in-flight remittances drain. They will age into [12. Remittance Stuck in a Non-Terminal State](#12-remittance-stuck-in-a-non-terminal-state) if the anchor stays down past `ANCHOR_TIMEOUT_HOURS`.
6. Re-enable only after health probes report `online` for 15 minutes straight.

---

## 15. FX Rates Stale or Provider Circuit Open

**Alerts:** `SwiftRemitFxRateStale` (critical), `SwiftRemitFxRateStaleWarning` (warning), `SwiftRemitFxProviderCircuitOpen` (warning)

Quoting on a stale rate loses money on every transaction, so the critical variant is a page.

1. Check the age of the freshest rate and the breaker state:
   ```promql
   max(fx_rate_age_seconds)
   swiftremit_circuit_open{provider="fx"}
   ```
2. If the circuit is open, the primary provider is failing and quotes come from the secondary or from stale cache. The breaker half-opens automatically after 60 seconds.
3. Verify the primary provider's API key and rate limits (`FX_API_KEY`). Expired keys look exactly like an outage.
4. If both providers are down and rates exceed 15 minutes old, **stop accepting new remittances** rather than quoting on stale data.
5. Once a provider recovers, confirm `fx_rate_age_seconds` drops below 300 before resuming.

---

## 16. Background Job Failing or Stalled

**Alerts:** `SwiftRemitBackgroundJobStalled` (warning), `SwiftRemitKycPollFailureRateHigh` (warning)

1. Identify the job:
   ```promql
   time() - max by (job_name) (swiftremit_job_last_run_timestamp)
   swiftremit_job_failure_total
   ```
2. Check the scheduler is alive at all — if every job is stalled, the process died rather than one job failing.
3. For KYC polling specifically, check anchor availability and KYC API throttling before assuming a bug.
4. Restart the backend to restart the scheduler. Jobs are idempotent and resume from the database.
5. If one job fails repeatedly while others run, pull its logs by `job_name` and open a ticket — do not silence the alert.

---

## 17. Database Connection Pool Saturation

**Alerts:** `SwiftRemitDbPoolSaturated` (critical), `SwiftRemitDbPoolNearlyExhausted` (warning)

1. Confirm the shape of the saturation:
   ```promql
   db_pool_active_connections
   db_pool_idle_connections
   db_pool_waiting_connections
   ```
2. Look for long-running queries holding connections:
   ```sql
   SELECT pid, now() - query_start AS duration, state, left(query, 120)
     FROM pg_stat_activity
    WHERE state <> 'idle'
    ORDER BY duration DESC
    LIMIT 20;
   ```
3. Cancel a runaway query with `SELECT pg_cancel_backend(<pid>);` — escalate to `pg_terminate_backend` only if cancelling does not work.
4. A pool that is fully active with nothing long-running means genuine load: raise `DB_POOL_MAX` and scale the deployment.
5. A pool that stays saturated after load drops means a connection leak — restart the service and open a ticket with the code path that leaked.

---

## 18. Accumulated Fees Above Threshold

**Alert:** `SwiftRemitAccumulatedFeesThresholdExceeded` (warning)

1. Confirm the figure against the database:
   ```sql
   SELECT COALESCE(SUM(amount_fee), 0) FROM transactions WHERE status = 'completed';
   ```
2. Compare against the on-chain accumulated fee balance. A mismatch is a divergence, not a treasury problem — go to [13. On-Chain State Divergence](#13-on-chain-state-divergence).
3. If the figures agree, sweep the treasury following the fee-withdrawal procedure and record the ledger sequence.
4. If the threshold no longer reflects real volume, raise it in `monitoring/alerts.yml` rather than muting the alert.

---

## 19. Escalation Contacts and SLA Targets

| Severity | Definition | Response SLA | Resolution SLA | Escalation Path |
|----------|-----------|-------------|----------------|-----------------|
| P0 | Contract paused / funds at risk | 15 min | 2 hours | On-call engineer → Lead engineer → CTO |
| P1 | Webhook delivery failures > 10% | 30 min | 4 hours | On-call engineer → Backend lead |
| P2 | Migration stuck / partial state | 1 hour | 8 hours | On-call engineer → Contract lead |
| P3 | TTL warnings / non-critical degradation | 4 hours | 24 hours | On-call engineer |

## Prometheus alerting rules

Alerting rules live in two files, both loaded by `backend/monitoring/prometheus.yml`:

- `monitoring/alerts.yml` — operational alerts, grouped by what they mean:
  funds at risk, degraded dependencies, delivery and background work, infrastructure.
- `monitoring/slo.yml` — SLO recording rules and error-budget burn alerts.

Every alert carries a `severity` (`critical` pages, `warning` opens a ticket), a
`team` label used for Alertmanager routing, and a `runbook_url` annotation that
points at a section of this file. `scripts/check-alert-runbooks.js` fails CI if an
alert points at a section that does not exist, so this index cannot drift.

Rule behaviour is verified with synthetic series in `monitoring/alerts_test.yml`
(`promtool test rules`), which is run by the `monitoring` GitHub Actions workflow.

| Alert | Severity | Runbook |
|-------|----------|---------|
| `SwiftRemitContractPaused` | critical | [2. Circuit Breaker](#2-circuit-breaker-multi-admin-vote-to-unpause) |
| `SwiftRemitOldestPendingRemittanceStuck` | critical | [12. Remittance Stuck](#12-remittance-stuck-in-a-non-terminal-state) |
| `SwiftRemitStateDivergence` | critical | [13. State Divergence](#13-on-chain-state-divergence) |
| `SwiftRemitAnchorCircuitOpen` | critical | [14. Anchor Unavailable](#14-anchor-unavailable-or-circuit-open) |
| `SwiftRemitFxRateStale` | critical | [15. FX Rates Stale](#15-fx-rates-stale-or-provider-circuit-open) |
| `SwiftRemitDeadLetterQueueCritical` | critical | [6. Replay Failed Webhook Deliveries](#6-replay-failed-webhook-deliveries) |
| `SwiftRemitMigrationFailed` | critical | [5. Handle a Stuck Migration](#5-handle-a-stuck-migration) |
| `SwiftRemitDbPoolSaturated` | critical | [17. Pool Saturation](#17-database-connection-pool-saturation) |
| `SwiftRemitAvailabilityBudgetBurnFast` | critical | [9. API Availability SLO Burn](#9-api-availability-slo-burn) |
| `SwiftRemitLatencyBudgetBurnFast` | warning | [10. API Latency SLO Burn](#10-api-latency-slo-burn) |
| `SwiftRemitSettlementTimeSLOBreached` | warning | [11. Settlement Time SLO](#11-remittance-settlement-time-slo-breach) |
| `SwiftRemitBackgroundJobStalled` | warning | [16. Background Job Stalled](#16-background-job-failing-or-stalled) |
| `SwiftRemitAccumulatedFeesThresholdExceeded` | warning | [18. Accumulated Fees](#18-accumulated-fees-above-threshold) |

Dashboards are provisioned from `monitoring/dashboards/` — see
`monitoring/provisioning/`. They are never hand-created in the Grafana UI.

**Escalation contacts:**

| Role | Contact |
|------|---------|
| On-call engineer | Rotate weekly — see PagerDuty schedule |
| Contract lead | See `CONTRIBUTING.md` maintainers section |
| Backend lead | See `CONTRIBUTING.md` maintainers section |
| Security incidents | security@[your-domain] |

**Incident channels:**
- Slack: `#incidents` (P0/P1), `#engineering` (P2/P3)
- GitHub: tag issues with `incident` label and severity (`P0`–`P3`)
- Post-mortems: required for all P0 incidents within 48 hours of resolution

---

## Admin Key Rotation

See [docs/KEY_MANAGEMENT_POLICY.md](docs/KEY_MANAGEMENT_POLICY.md) for the full rotation policy (SR-111).  
Rehearsal script: `scripts/rehearse-key-rotation.sh`

All mainnet admin keys must be stored on hardware wallets (Ledger/Trezor) or HSMs. Rotate at minimum quarterly and before every mainnet upgrade.

**Summary of the 6-step rotation procedure:**

1. **Generate** a new keypair on a hardware wallet — never on an internet-connected device.
2. **Propose** the new admin address with `propose_admin --new_admin $NEW_ADMIN_ADDRESS` (signed by current admin).
3. **Accept** the proposal with `accept_admin` (signed by the new admin from their hardware wallet).
4. **Verify** the new key is active: `is_admin --address $NEW_ADMIN_ADDRESS` and `get_admin_list`.
5. **Remove** the old key with `remove_admin --admin_to_remove $OLD_ADMIN_ADDRESS` — only after Step 4 succeeds and admin count exceeds the multisig threshold.
6. **Confirm** the final admin count with `get_admin_count`; post the transaction hash in `#incidents`.

---

## Key Compromise Response

See [docs/KEY_MANAGEMENT_POLICY.md](docs/KEY_MANAGEMENT_POLICY.md) Section 5 for the full playbook (SR-111).  
Rehearsal script: `scripts/rehearse-compromise-response.sh`  
**Target RTO: 2 hours** from detection to service restoration.

Treat any suspected compromise as confirmed until proven otherwise. Use out-of-band Signal/Telegram for all coordination — do not rely on Slack during an active incident.

| Time | Action |
|------|--------|
| T+0 | `emergency_pause` from any remaining admin |
| T+15 min | Convene key holders on out-of-band channel |
| T+30 min | `propose_operation` + `approve_operation` to remove compromised key (M ≥ 2) |
| T+1 h | `propose_admin` / `accept_admin` to add replacement key |
| T+2 h | `vote_unpause` to quorum; verify `get_admin_list` and `health()` |
| T+4 h | Notify users and regulators per compliance requirements |
| T+24 h | Publish post-mortem (GitHub issue: `incident`, `P0`, `post-mortem`) |
