# Rollback & Emergency-Pause Runbook — SR-106

> **Audience:** On-call engineers, contract administrators.  
> **Purpose:** Step-by-step recovery from a failed or compromised mainnet deployment.
>
> **This file is canonical for mainnet incident recovery** — the severity decision
> tree, WASM rollback, state migration to a new contract ID, and the authority
> matrix. For day-to-day admin operations (routine pause/unpause, key rotation,
> stuck migrations, webhook replay, storage TTL, SLO-alert response) and for
> testnet, see [RUNBOOK.md](RUNBOOK.md). Both runbooks use the `stellar` CLI and
> the commands are copy-paste compatible.

---

## Table of Contents

1. [Severity levels and decision tree](#1-severity-levels-and-decision-tree)
2. [Trigger the emergency pause](#2-trigger-the-emergency-pause)
3. [Verify the contract is paused](#3-verify-the-contract-is-paused)
4. [Assess the situation](#4-assess-the-situation)
5. [Rollback: redeploy a prior WASM version](#5-rollback-redeploy-a-prior-wasm-version)
6. [Unpause after remediation](#6-unpause-after-remediation)
7. [Post-incident checklist](#7-post-incident-checklist)
8. [Rehearsal on testnet](#8-rehearsal-on-testnet)
9. [Authority matrix](#9-authority-matrix)

---

## 1. Severity levels and decision tree

| Symptom | Severity | Action |
|---------|----------|--------|
| Smoke tests fail after deploy | P0 | Pause immediately (automated) |
| On-chain WASM hash mismatch | P0 | Do not promote; pause if already promoted |
| Funds not moving / stuck | P1 | Pause, investigate |
| Elevated error rate > 10% | P1 | Pause, investigate |
| Elevated error rate 1–10% | P2 | Monitor; prepare to pause |
| Single failing endpoint | P3 | Hotfix; no pause needed |

**When in doubt, pause. Pausing is reversible. Fund loss is not.**

---

## 2. Trigger the emergency pause

### Using the stellar CLI (primary method)

```bash
stellar contract invoke \
  --id "$MAINNET_CONTRACT_ID" \
  --source-account "$MAINNET_EMERGENCY_ADMIN_KEY" \
  --rpc-url "$MAINNET_RPC_URL" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  -- emergency_pause \
  --caller "$ADMIN_STELLAR_ADDRESS" \
  --reason '"Incident: <brief description>"'
```

**Required environment variables:**

| Variable | Description |
|----------|-------------|
| `MAINNET_CONTRACT_ID` | Deployed contract address |
| `MAINNET_EMERGENCY_ADMIN_KEY` | Secret key of an admin address |
| `MAINNET_RPC_URL` | Soroban RPC endpoint (e.g. `https://soroban-rpc.mainnet.stellar.org`) |
| `ADMIN_STELLAR_ADDRESS` | Public key matching `MAINNET_EMERGENCY_ADMIN_KEY` |

### Using the legacy pause (single-admin, no quorum/timelock)

If governance multi-sig quorum prevents fast action, use the legacy wrapper:

```bash
stellar contract invoke \
  --id "$MAINNET_CONTRACT_ID" \
  --source-account "$MAINNET_EMERGENCY_ADMIN_KEY" \
  --rpc-url "$MAINNET_RPC_URL" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  -- pause
```

> The `pause` function bypasses quorum/timelock. Use only for true emergencies.

### Using scripts/smoke-mainnet.sh

The smoke-test script calls `emergency_pause` automatically when post-deploy checks fail.
This is the automated path — it requires no manual intervention during CI.

---

## 3. Verify the contract is paused

```bash
stellar contract invoke \
  --id "$MAINNET_CONTRACT_ID" \
  --rpc-url "$MAINNET_RPC_URL" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  -- is_paused
# Expected output: true
```

Also call `get_current_pause_record` to confirm the pause reason was recorded:

```bash
stellar contract invoke \
  --id "$MAINNET_CONTRACT_ID" \
  --rpc-url "$MAINNET_RPC_URL" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  -- get_current_pause_record
```

---

## 4. Assess the situation

Once paused, there is no urgency. Work systematically:

1. **Retrieve the deployment record** from the workflow artifact `mainnet-deployment-record`
   or from `docs/deployment-history.json`.
2. **Check the on-chain WASM hash:**
   ```bash
   stellar contract info \
     --id "$MAINNET_CONTRACT_ID" \
     --rpc-url "$MAINNET_RPC_URL"
   # Note the wasm_hash field
   ```
3. **Compare against the reproducible-build hash** in `releases/latest-hash.txt` or the
   corresponding release tag file `releases/<tag>.sha256`.
4. **Review the smoke test logs** in the GitHub Actions workflow run that triggered the pause.
5. **Decide:** hotfix and re-deploy, or roll back to the previous contract ID.

---

## 5. Rollback: redeploy a prior WASM version

Soroban contracts cannot be "rolled back" in place. The state lives on-chain at the
current contract ID. The rollback strategy is:

**a. Deploy the last known-good WASM to a new contract ID**

```bash
# Download the known-good WASM from the GitHub Release for the prior version
gh release download <prior-tag> \
  --pattern "swiftremit.wasm" \
  --dir /tmp/rollback/

# Deploy to a new contract ID
stellar contract deploy \
  --wasm /tmp/rollback/swiftremit.wasm \
  --source-account "$MAINNET_DEPLOYER_SECRET_KEY" \
  --rpc-url "$MAINNET_RPC_URL" \
  --network-passphrase "Public Global Stellar Network ; September 2015"
# Note the new CONTRACT_ID
```

**b. Initialise the new contract**

```bash
stellar contract invoke \
  --id "<new-CONTRACT_ID>" \
  --source-account "$MAINNET_DEPLOYER_SECRET_KEY" \
  --rpc-url "$MAINNET_RPC_URL" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  -- initialize \
  --admin "$ADMIN_STELLAR_ADDRESS" \
  --usdc_token "$MAINNET_USDC_TOKEN" \
  --fee_bps 250 \
  --rate_limit_cooldown 60 \
  --protocol_fee_bps 25 \
  --treasury "$TREASURY_ADDRESS"
```

**c. Migrate state if necessary**

If there are in-flight remittances in the paused contract, use the migration functions:
```bash
# Export state from the paused contract
stellar contract invoke --id "$OLD_CONTRACT_ID" ... -- export_migration_snapshot \
  --caller "$ADMIN_STELLAR_ADDRESS"

# Import into the new contract (may require multiple batch calls)
stellar contract invoke --id "$NEW_CONTRACT_ID" ... -- import_migration_batch \
  --caller "$ADMIN_STELLAR_ADDRESS" \
  --batch '<batch-json>'
```

**d. Update downstream services**

Update `SWIFTREMIT_CONTRACT_ID` in:
- Backend service environment / secrets
- API service environment / secrets
- Frontend environment / secrets
- Any external integrations

**e. Run smoke tests against the new contract**

```bash
MAINNET_CONTRACT_ID="<new-CONTRACT_ID>" \
  bash scripts/smoke-mainnet.sh
```

**f. Record the rollback in deployment-history.json**

```bash
# Add an entry with "event": "rollback" to docs/deployment-history.json
```

---

## 6. Unpause after remediation

Do **not** unpause until:
- [ ] Root cause is identified and fixed (or rollback is confirmed safe)
- [ ] New smoke tests pass against a testnet deployment of the fix
- [ ] At least two admins have reviewed and approved

### Unpause via governance (normal path)

```bash
# Each required admin calls vote_unpause
stellar contract invoke \
  --id "$MAINNET_CONTRACT_ID" \
  --source-account "$ADMIN_SECRET_KEY_N" \
  --rpc-url "$MAINNET_RPC_URL" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  -- vote_unpause \
  --caller "$ADMIN_ADDRESS_N"
```

Repeat for each required admin until quorum is reached (auto-unpauses).

### Unpause legacy (bypass timelock — emergencies only)

```bash
stellar contract invoke \
  --id "$MAINNET_CONTRACT_ID" \
  --source-account "$MAINNET_EMERGENCY_ADMIN_KEY" \
  --rpc-url "$MAINNET_RPC_URL" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  -- unpause
```

---

## 7. Post-incident checklist

- [ ] Incident documented in your incident tracker
- [ ] Root cause analysis (RCA) written and shared
- [ ] `docs/deployment-history.json` updated with event and resolution
- [ ] `CHANGELOG.md` updated if a code fix was deployed
- [ ] Smoke-test coverage improved if the incident revealed a gap
- [ ] Monitoring/alerting improved if the incident was not caught automatically
- [ ] Runbook updated if any steps were wrong or missing

---

## 8. Rehearsal on testnet

Run this procedure on testnet **before every mainnet release**:

```bash
# 1. Deploy to testnet
TESTNET_CONTRACT_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/swiftremit.optimized.wasm \
  --source-account "$TESTNET_DEPLOYER_KEY" \
  --network testnet)

# 2. Run testnet smoke test
MAINNET_CONTRACT_ID="$TESTNET_CONTRACT_ID" \
  MAINNET_RPC_URL="https://soroban-testnet.stellar.org" \
  MAINNET_SMOKE_ACCOUNT="$TESTNET_SMOKE_ACCOUNT" \
  MAINNET_SMOKE_SECRET_KEY="$TESTNET_SMOKE_SECRET_KEY" \
  MAINNET_SMOKE_AGENT="$TESTNET_SMOKE_AGENT" \
  MAINNET_EMERGENCY_ADMIN_KEY="$TESTNET_ADMIN_KEY" \
  bash scripts/smoke-mainnet.sh

# 3. Deliberately trigger emergency_pause to verify it works
stellar contract invoke \
  --id "$TESTNET_CONTRACT_ID" \
  --source-account "$TESTNET_ADMIN_KEY" \
  --network testnet \
  -- emergency_pause \
  --caller "$TESTNET_ADMIN_ADDRESS" \
  --reason '"Rehearsal pause"'

# 4. Verify paused
stellar contract invoke --id "$TESTNET_CONTRACT_ID" --network testnet -- is_paused

# 5. Unpause
stellar contract invoke \
  --id "$TESTNET_CONTRACT_ID" \
  --source-account "$TESTNET_ADMIN_KEY" \
  --network testnet \
  -- unpause
```

The `mainnet-checklist.yml` CI workflow runs a dry-run version of this on every
push to `main` to keep credentials valid and the process exercised.

---

## 9. Authority matrix

| Action | Who may perform |
|--------|----------------|
| Trigger `emergency_pause` | Any registered admin |
| Vote to unpause | Any registered admin |
| Deploy new contract version | Deployer key holder (stored in GitHub Secret `MAINNET_DEPLOYER_SECRET_KEY`) |
| Migrate state | Admin with `MAINNET_EMERGENCY_ADMIN_KEY` |
| Update downstream service secrets | DevOps / on-call engineer |
| Approve RCA and post-mortem | Engineering lead + Security lead |

> Store all mainnet secret keys in a hardware security module (HSM) or equivalent.
> Do not store them in plaintext on any developer machine.
