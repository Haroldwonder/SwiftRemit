# SwiftRemit Operational Runbook

On-call reference for common production procedures. All `soroban contract invoke` commands assume the following environment variables are set:

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
soroban contract invoke \
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
soroban contract invoke \
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

## 2. Unpause After Incident Resolution

Unpausing requires admin quorum votes (default: 1). If a timelock is configured, the elapsed time since the pause must exceed `timelock_seconds` before the unpause is accepted.

**Step 1 — each admin casts a vote:**

```bash
soroban contract invoke \
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
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  emergency_unpause \
  --caller $ADMIN_ADDRESS
```

Verify:

```bash
soroban contract invoke \
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

## 3. Rotate Admin Keys via Governance Proposal

Admin key rotation uses the on-chain governance module. The process is: propose → vote → execute (after timelock).

**Step 1 — propose adding the new admin:**

```bash
soroban contract invoke \
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
soroban contract invoke \
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
soroban contract invoke \
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
soroban contract invoke \
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
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  get_admin_count
```

---

## 4. Handle a Stuck Migration

A migration can become stuck if a batch import fails mid-flight or the contract is paused during migration.

**Check current migration state:**

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  export_state
```

Inspect `schema_version` and whether a rollback snapshot exists.

**Option A — abort and reset to Idle:**

```bash
soroban contract invoke \
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
soroban contract invoke \
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
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  import_batch \
  --batch '<BATCH_JSON>'
```

---

## 5. Replay Failed Webhook Deliveries

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

## 6. Extend Contract Storage TTL

Soroban persistent storage entries expire after a set number of ledgers. Extend TTL before entries expire to avoid data loss.

**Check current TTL for a remittance entry:**

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  get_remittance \
  --remittance_id <ID>
```

**Extend TTL via Soroban CLI (bump ledgers):**

```bash
soroban contract extend \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  --ledgers-to-extend 500000 \
  --durability persistent
```

For individual storage keys (e.g., a specific remittance):

```bash
soroban contract extend \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  --key '{"Remittance": <ID>}' \
  --ledgers-to-extend 500000 \
  --durability persistent
```

Recommended: run a scheduled job (weekly) to bump TTL on all active remittances before they approach expiry. The `process_expired_remittances` function handles logical expiry; this procedure handles Soroban storage-level TTL.

---

## 7. Escalation Contacts and SLA Targets

| Severity | Definition | Response SLA | Resolution SLA | Escalation Path |
|----------|-----------|-------------|----------------|-----------------|
| P0 | Contract paused / funds at risk | 15 min | 2 hours | On-call engineer → Lead engineer → CTO |
| P1 | Webhook delivery failures > 10% | 30 min | 4 hours | On-call engineer → Backend lead |
| P2 | Migration stuck / partial state | 1 hour | 8 hours | On-call engineer → Contract lead |
| P3 | TTL warnings / non-critical degradation | 4 hours | 24 hours | On-call engineer |

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
