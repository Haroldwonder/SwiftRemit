#!/usr/bin/env bash
# smoke-mainnet.sh — SR-106
#
# Post-deploy smoke test for the SwiftRemit mainnet contract.
# Creates a minimal remittance with a dedicated smoke-test account,
# polls until Completed or timeout, and triggers emergency_pause on failure.
#
# Required environment variables:
#   MAINNET_RPC_URL              – Soroban RPC endpoint for mainnet
#   MAINNET_CONTRACT_ID          – Deployed contract ID
#   MAINNET_SMOKE_ACCOUNT        – Stellar address of the smoke-test account
#   MAINNET_SMOKE_SECRET_KEY     – Secret key for the smoke-test account
#   MAINNET_SMOKE_AGENT          – Stellar address of a registered smoke-test agent
#   MAINNET_SMOKE_USDC_TOKEN     – USDC token contract ID on mainnet
#   MAINNET_EMERGENCY_ADMIN_KEY  – Secret key authorised to call emergency_pause
#
# Optional:
#   POLL_TIMEOUT_SECS  (default: 120) – seconds before giving up
#   POLL_INTERVAL_SECS (default: 5)   – seconds between status polls
#
# Exit codes:
#   0 – smoke test passed
#   1 – smoke test failed (emergency_pause triggered automatically)

set -euo pipefail

: "${MAINNET_RPC_URL:?MAINNET_RPC_URL must be set}"
: "${MAINNET_CONTRACT_ID:?MAINNET_CONTRACT_ID must be set}"
: "${MAINNET_SMOKE_ACCOUNT:?MAINNET_SMOKE_ACCOUNT must be set}"
: "${MAINNET_SMOKE_SECRET_KEY:?MAINNET_SMOKE_SECRET_KEY must be set}"
: "${MAINNET_SMOKE_AGENT:?MAINNET_SMOKE_AGENT must be set}"
: "${MAINNET_EMERGENCY_ADMIN_KEY:?MAINNET_EMERGENCY_ADMIN_KEY must be set}"

POLL_TIMEOUT_SECS="${POLL_TIMEOUT_SECS:-120}"
POLL_INTERVAL_SECS="${POLL_INTERVAL_SECS:-5}"

NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
# Minimum smoke amount: 1 USDC in stroops (0.0000001 XLM units, USDC uses 7 decimals)
SMOKE_AMOUNT="1000000"

log()  { echo "[smoke-mainnet] $*"; }
err()  { echo "[smoke-mainnet] ERROR: $*" >&2; }
fail() { err "$*"; exit 1; }

# ── Helper: invoke contract ───────────────────────────────────────────────────
invoke() {
  stellar contract invoke \
    --id "$MAINNET_CONTRACT_ID" \
    --rpc-url "$MAINNET_RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    "$@"
}

invoke_with_key() {
  local key="$1"; shift
  stellar contract invoke \
    --id "$MAINNET_CONTRACT_ID" \
    --source-account "$key" \
    --rpc-url "$MAINNET_RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    "$@"
}

# ── Check stellar CLI available ───────────────────────────────────────────────
if ! command -v stellar &>/dev/null; then
  fail "stellar CLI not found — install it before running smoke tests"
fi

# ── Verify contract is not already paused ────────────────────────────────────
log "Checking contract pause status…"
IS_PAUSED=$(invoke -- is_paused 2>/dev/null | tr -d '"' | tr -d '\n' || echo "error")
if [ "$IS_PAUSED" = "true" ]; then
  fail "Contract is already paused — smoke test cannot proceed. Investigate before deployment."
fi
log "Contract is active (not paused) ✓"

# ── Create a smoke remittance ─────────────────────────────────────────────────
log "Creating smoke remittance (amount=$SMOKE_AMOUNT stroops)…"

IDEMPOTENCY_KEY="smoke-$(date -u +%Y%m%dT%H%M%SZ)-$$"

REMITTANCE_OUTPUT=$(invoke_with_key "$MAINNET_SMOKE_SECRET_KEY" -- \
  create_remittance \
  --sender "$MAINNET_SMOKE_ACCOUNT" \
  --agent "$MAINNET_SMOKE_AGENT" \
  --amount "$SMOKE_AMOUNT" \
  --idempotency_key "$IDEMPOTENCY_KEY" \
  2>&1) || {
  err "create_remittance failed:"
  err "$REMITTANCE_OUTPUT"
  emergency_pause "create_remittance failed during smoke test"
  exit 1
}

# Extract remittance_id from output (stellar CLI returns the result as a string/u64)
REMITTANCE_ID=$(echo "$REMITTANCE_OUTPUT" | grep -Eo '[0-9]+' | tail -1)

if [ -z "$REMITTANCE_ID" ]; then
  err "Could not extract remittance_id from output: $REMITTANCE_OUTPUT"
  emergency_pause "Could not parse remittance_id from create_remittance output"
  exit 1
fi

log "Smoke remittance created — ID: $REMITTANCE_ID ✓"

# ── Poll for completion ───────────────────────────────────────────────────────
log "Polling for remittance status (timeout=${POLL_TIMEOUT_SECS}s, interval=${POLL_INTERVAL_SECS}s)…"

ELAPSED=0
FINAL_STATUS=""

while [ "$ELAPSED" -lt "$POLL_TIMEOUT_SECS" ]; do
  STATUS=$(invoke -- get_transfer_state \
    --transfer_id "$REMITTANCE_ID" \
    2>/dev/null | tr -d '"' | tr -d '{}' | tr -d '\n' | xargs || echo "error")

  log "  [${ELAPSED}s] status = $STATUS"

  case "$STATUS" in
    Completed)
      FINAL_STATUS="Completed"
      break
      ;;
    Cancelled|Failed)
      FINAL_STATUS="$STATUS"
      break
      ;;
    Pending|Processing)
      # still in flight — keep polling
      ;;
    *)
      err "Unexpected status: $STATUS"
      ;;
  esac

  sleep "$POLL_INTERVAL_SECS"
  ELAPSED=$((ELAPSED + POLL_INTERVAL_SECS))
done

# ── Evaluate result ───────────────────────────────────────────────────────────
if [ "$FINAL_STATUS" = "Completed" ]; then
  log "Smoke test PASSED — remittance $REMITTANCE_ID completed successfully ✓"
  exit 0
fi

# Failure path
if [ -z "$FINAL_STATUS" ]; then
  REASON="Timed out after ${POLL_TIMEOUT_SECS}s waiting for remittance $REMITTANCE_ID"
else
  REASON="Remittance $REMITTANCE_ID ended in unexpected status: $FINAL_STATUS"
fi

emergency_pause "$REASON"

# ── Emergency pause helper ────────────────────────────────────────────────────
emergency_pause() {
  local reason="$1"
  err "SMOKE TEST FAILED: $reason"
  err "Triggering emergency_pause to protect mainnet funds…"

  PAUSE_OUTPUT=$(invoke_with_key "$MAINNET_EMERGENCY_ADMIN_KEY" -- \
    emergency_pause \
    --caller "$MAINNET_SMOKE_ACCOUNT" \
    --reason "\"Automated smoke test failure: $reason\"" \
    2>&1) || true

  log "emergency_pause output: $PAUSE_OUTPUT"

  # Verify pause took effect
  PAUSED_CHECK=$(invoke -- is_paused 2>/dev/null | tr -d '"' | tr -d '\n' || echo "unknown")
  if [ "$PAUSED_CHECK" = "true" ]; then
    err "Contract has been PAUSED — investigate before unpausing."
    err "See docs/ROLLBACK_RUNBOOK.md for recovery steps."
  else
    err "WARNING: emergency_pause may not have taken effect (is_paused=$PAUSED_CHECK)"
    err "MANUALLY PAUSE THE CONTRACT IMMEDIATELY."
  fi

  exit 1
}
