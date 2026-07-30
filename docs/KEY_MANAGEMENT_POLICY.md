# Key Management Policy

**Document ID:** SR-111  
**Status:** Active  
**Last Reviewed:** 2026-07-30  
**Next Review Due:** 2026-10-30 (quarterly)  
**Owner:** Security / Contract Operations Team

---

## 1. Scope and Purpose

This policy governs all mainnet admin keys for the SwiftRemit Soroban smart contract deployed on the Stellar network. It defines custody requirements, rotation procedures, compromise response, and rehearsal obligations for every key that holds an on-chain role.

**SR-111** is the tracking issue for this policy. All rotation events, rehearsal results, and incident responses must reference SR-111 in their GitHub issues or post-mortems.

### In scope

- All addresses registered as `Admin` via `add_admin` / `register_agent` on **mainnet**.
- The Treasury address configured via `update_treasury`.
- The Deployer keypair used to publish new WASM upgrades on **testnet**.
- The CI/CD keypair used by GitHub Actions for automated testnet deployments.

### Out of scope

- Individual Sender or Agent keys (managed by those parties).
- Testnet addresses used only for integration testing (no mainnet funds or authority).

---

## 2. Key Inventory

The table below is the canonical inventory of all keys in scope. Operational secrets (actual addresses, holder names) are intentionally omitted here and maintained in the team's secure secrets manager. Update this table whenever a key is added, removed, or rotated.

| Key Name | Role | Holder (Name/Team) | Custody Method | Jurisdiction | Last Rotated | Next Rotation Due |
|---|---|---|---|---|---|---|
| Admin Key 1 | `Admin` (mainnet) | PLACEHOLDER | Hardware Wallet (Ledger/Trezor) or HSM | PLACEHOLDER | PLACEHOLDER | PLACEHOLDER (≤ 90 days from last rotation) |
| Admin Key 2 | `Admin` (mainnet) | PLACEHOLDER | Hardware Wallet (Ledger/Trezor) or HSM | PLACEHOLDER | PLACEHOLDER | PLACEHOLDER (≤ 90 days from last rotation) |
| Admin Key 3 | `Admin` (mainnet) | PLACEHOLDER | Hardware Wallet (Ledger/Trezor) or HSM | PLACEHOLDER | PLACEHOLDER | PLACEHOLDER (≤ 90 days from last rotation) |
| Treasury Key | Treasury recipient (mainnet) | PLACEHOLDER | Hardware Wallet (Ledger/Trezor) or HSM | PLACEHOLDER | PLACEHOLDER | PLACEHOLDER (≤ 90 days from last rotation) |
| Deployer Key | Contract deployer (testnet only) | PLACEHOLDER | Encrypted keystore, team secrets manager | N/A (testnet only) | PLACEHOLDER | Every 90 days or on team-member departure |
| CI/CD Key | Testnet deploy automation (testnet only) | DevOps / GitHub Actions | GitHub Actions Secret | N/A (testnet only) | PLACEHOLDER | Every 90 days or on team-member departure |

> **Maintenance note:** After each rotation, update the _Last Rotated_ and _Next Rotation Due_ columns and commit the change as a signed commit referencing the corresponding GitHub issue.

---

## 3. Custody Requirements

### 3.1 Hardware wallet / HSM mandate

All **mainnet** admin keys (Admin Key 1, 2, 3, and Treasury Key) **MUST** be stored on a hardware security device:

- **Hardware wallets:** Ledger (Nano X / Stax) or Trezor (Model T / Safe 5) running the Stellar application.
- **HSM:** A FIPS 140-2 Level 2 (or higher) HSM with Stellar ED25519 signing support.

Private key material must **never** exist in plaintext on any internet-connected device, server, CI/CD system, or secrets manager.

### 3.2 Zero-knowledge principle on servers

- No server, container, cloud instance, or CI runner may hold a mainnet admin private key.
- Environment variables on staging/production services must not contain mainnet admin secret keys.
- Automated signing for mainnet operations is not permitted; every mainnet admin action requires a human operator with physical access to the hardware wallet.

### 3.3 Multi-signature thresholds

The on-chain multisig configuration (set via `set_multisig_config`) must enforce the following minimum thresholds. Never lower the threshold below the values in this table without a separate governance proposal.

| Operation | Min Threshold (M) | Rationale |
|---|---|---|
| `withdraw_fees` | M ≥ 2 | Prevents unilateral fund extraction by a single compromised admin |
| `emergency_pause` | M ≥ 1 | Any single admin can halt in an emergency; speed is critical |
| `update_fee` | M ≥ 2 | Fee changes affect all users; requires consensus |
| `register_agent` | M ≥ 1 | Single trusted admin can onboard a vetted agent |
| WASM upgrade | M ≥ 2, governance proposal required | Code changes require broad consensus and timelock |
| `add_admin` | M ≥ 2 | Adding a new admin expands the trust boundary |
| `propose_operation` | M ≥ 1 | Any admin may propose; execution still requires threshold approvals |

### 3.4 Physical and organisational controls

- Each hardware wallet must be stored in a physically secured location (e.g., locked safe or safety deposit box).
- Seed phrases must be stored separately from the device, in a different physical location, using fire/water-resistant media.
- No single person may hold both the device and the seed phrase backup for the same key.
- A record of each key's physical location must be kept in the team's secure document store (not in this file).

---

## 4. Normal Rotation Procedure

Rotate **at minimum quarterly** and **before every mainnet WASM upgrade**. Rotation uses the two-step `propose_admin` / `accept_admin` handover to ensure the new key is functional before the old key is removed.

All commands use environment variables. Set them before running:

```bash
export CONTRACT_ID=<deployed_contract_id>
export NETWORK=mainnet          # or testnet for rehearsal
export RPC_URL=<soroban_rpc_url>
export CURRENT_ADMIN_IDENTITY=<soroban_cli_identity_for_current_admin>
export CURRENT_ADMIN_ADDRESS=<current_admin_stellar_address>
export NEW_ADMIN_IDENTITY=<soroban_cli_identity_for_new_admin>
export NEW_ADMIN_ADDRESS=<new_admin_stellar_address>
```

---

### Step 1 — Generate the new key on a hardware wallet

Generate the replacement keypair on the hardware wallet device, **never on an internet-connected computer**. Record the public key (Stellar G-address) as `NEW_ADMIN_ADDRESS`.

> If using Ledger: use the Stellar app's key derivation. Confirm the address on the device screen before noting it down.

---

### Step 2 — Propose the admin transfer

The current admin proposes the new address as the successor:

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $CURRENT_ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  propose_admin \
  --new_admin $NEW_ADMIN_ADDRESS
```

Record the transaction hash and ledger sequence in the rotation log.

---

### Step 3 — New admin accepts

The new admin authenticates with their hardware wallet and accepts the proposal:

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $NEW_ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  accept_admin
```

---

### Step 4 — Verify the new key is active

```bash
# Confirm the new address is now an admin
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- \
  is_admin \
  --address $NEW_ADMIN_ADDRESS

# Inspect the full admin list
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- \
  get_admin_list
```

Both checks must succeed before proceeding to key removal.

---

### Step 5 — Remove the old key

Only remove the old key after Step 4 confirms the new key is active. Verify that the current admin count exceeds the multisig threshold before removing.

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $NEW_ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  remove_admin \
  --caller $NEW_ADMIN_ADDRESS \
  --admin_to_remove $CURRENT_ADMIN_ADDRESS
```

---

### Step 6 — Verify the admin count

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- \
  get_admin_count
```

Confirm the count is at least the configured multisig threshold (typically ≥ 2 for mainnet). Post the transaction hash and new admin count in the `#incidents` Slack channel and close the rotation GitHub issue.

---

### Rotation frequency

| Trigger | Required action |
|---|---|
| Quarterly calendar reminder | Full rotation for all admin keys |
| Before any mainnet WASM upgrade | Full rotation for any key that has not been rotated in the past 30 days |
| Team-member departure | Immediate rotation of any key the departing member had custody of |
| Suspected key exposure | Follow Section 5 (Compromise Response) instead |

---

## 5. Compromise Response Playbook

Treat any suspected key compromise as a confirmed incident until proven otherwise. The target **RTO (Recovery Time Objective) is 2 hours** from detection to service restoration.

Use out-of-band communication (Signal or Telegram group) for all coordination — do not rely on Slack or GitHub during an active compromise investigation.

| Step | Action | Tool / Function | Target Time | Owner |
|---|---|---|---|---|
| 1 | Pause the contract immediately | `emergency_pause(caller, reason="SecurityIncident")` | T+0 | Any available admin |
| 2 | Convene the key-holder team on out-of-band channel (Signal / Telegram) | Out-of-band comms | T+15 min | Incident Commander |
| 3 | Confirm which key is compromised; agree on replacement key (new hardware wallet keypair) | Manual verification | T+20 min | Key Holders |
| 4 | Propose removal of compromised key via multisig | `propose_operation` + `approve_operation` (M ≥ 2) | T+30 min | Remaining Admins |
| 5 | Execute the removal proposal once threshold is reached | `approve_operation` (auto-executes at threshold) | T+45 min | Remaining Admins |
| 6 | Add replacement key via `propose_admin` / `accept_admin` | Steps 2–3 from Section 4 | T+1 h | Incident Commander + New Key Holder |
| 7 | Verify key set; run health check | `get_admin_list`, `health()` | T+1.5 h | Incident Commander |
| 8 | Coordinate vote-to-unpause quorum | `vote_unpause` from each remaining admin | T+2 h | All Admins |
| 9 | Confirm service restored | `is_paused` → false; monitor remittance creation | T+2 h | On-Call Engineer |
| 10 | Notify users and regulators per compliance requirements | Email / status page / regulatory contact | T+4 h | Compliance / CEO |
| 11 | Publish post-mortem | GitHub issue tagged `incident`, `P0`, `post-mortem` | T+24 h | Incident Commander |

### Exact commands for compromise response

```bash
# T+0 — pause immediately (any remaining admin)
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  emergency_pause \
  --caller $ADMIN_ADDRESS \
  --reason SecurityIncident

# T+30m — propose removal of compromised key (multisig)
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $REMAINING_ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  propose_operation \
  --proposer $REMAINING_ADMIN_ADDRESS \
  --operation_type RemoveAdmin

# Second admin approves (auto-executes at threshold)
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $SECOND_ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  approve_operation \
  --approver $SECOND_ADMIN_ADDRESS \
  --operation_id <OPERATION_ID>

# T+1h — add replacement key (propose then accept)
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $REMAINING_ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  propose_admin \
  --new_admin $REPLACEMENT_ADMIN_ADDRESS

soroban contract invoke \
  --id $CONTRACT_ID \
  --source $REPLACEMENT_ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  accept_admin

# T+2h — vote to unpause (each admin votes independently)
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network $NETWORK \
  -- \
  vote_unpause \
  --caller $ADMIN_ADDRESS

# T+2h — verify health
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- \
  health
```

---

## 6. Testnet Rehearsal Requirements

Rehearsals on testnet validate that the documented procedures work before they are needed in production. **No rehearsal should be skipped.** Record all outcomes in the log below.

### Rehearsal schedule

| Rehearsal Type | Frequency | Mandatory Trigger |
|---|---|---|
| Key rotation rehearsal | Quarterly minimum | Before each mainnet upgrade |
| Compromise response rehearsal | Annually | Before mainnet launch (first time) |

### How to run

- **Rotation rehearsal:** `scripts/rehearse-key-rotation.sh` (SR-111)
- **Compromise response rehearsal:** `scripts/rehearse-compromise-response.sh` (SR-111)

Both scripts run against testnet and print a timestamped PASS/FAIL summary. Attach the output to the sign-off GitHub issue.

### Rehearsal log

| Date | Rehearsal Type | Participants | Outcome | Issues Found | Sign-off |
|---|---|---|---|---|---|
| PLACEHOLDER | Key Rotation | PLACEHOLDER | PLACEHOLDER | PLACEHOLDER | PLACEHOLDER |
| PLACEHOLDER | Compromise Response | PLACEHOLDER | PLACEHOLDER | PLACEHOLDER | PLACEHOLDER |

> Append a new row after every rehearsal. Never delete historical rows.

---

## 7. CI/CD Key Controls

GitHub Actions automation is used for testnet deployments only. CI/CD keys must never hold any mainnet role.

| Control | Requirement |
|---|---|
| Scope | Testnet deploy only — no `Admin` role on mainnet, ever |
| Storage | GitHub Actions Secrets (repository or environment level). Never committed to the repository. |
| Access | Only the DevOps team and repository admins may read or update the secret value |
| Rotation trigger | On every team-member departure (same day) and every 90 days by calendar |
| Least-privilege audit | Quarterly review of all GitHub Actions Secrets to confirm no secret has broader scope than required |
| Key generation | Generated by the DevOps lead on a clean workstation; old secret deleted from GitHub after new one is confirmed working |

### Rotation procedure for CI/CD key

1. Generate a new Stellar keypair on a clean workstation (not the CI runner):
   ```bash
   stellar keys generate ci-deploy-new --network testnet
   stellar keys address ci-deploy-new
   ```
2. Add the new key to the testnet contract as a limited role (if applicable).
3. Update the GitHub Actions Secret (`DEPLOYER_SECRET_KEY` or equivalent) with the new value.
4. Trigger a test workflow run to confirm the new key works.
5. Remove the old key from any on-chain registrations (testnet only).
6. Delete the old keypair from local storage.
7. Update the _Last Rotated_ column in Section 2.

---

## 8. Incident Escalation Contacts

Update this table with real contact details and store sensitive entries in the team's secure document store.

| Role | Name | Contact Method | Availability |
|---|---|---|---|
| Incident Commander | PLACEHOLDER | Signal: PLACEHOLDER | 24/7 on-call (rotating) |
| Contract Lead | PLACEHOLDER | Signal: PLACEHOLDER / Email: PLACEHOLDER | Business hours + on-call |
| Security Lead | PLACEHOLDER | Signal: PLACEHOLDER / Email: security@swiftremit.example | 24/7 on-call |
| DevOps Lead | PLACEHOLDER | Signal: PLACEHOLDER | Business hours + on-call |
| Legal / Compliance | PLACEHOLDER | Email: PLACEHOLDER | Business hours |
| CEO / Executive | PLACEHOLDER | Signal: PLACEHOLDER | As needed for P0 |
| Stellar Foundation (critical network issues) | N/A | https://discord.gg/stellar | Community support |

> **Out-of-band channel:** All P0 incidents must use the pre-established Signal/Telegram group, not Slack. Ensure all key holders are members of this group before mainnet launch.
