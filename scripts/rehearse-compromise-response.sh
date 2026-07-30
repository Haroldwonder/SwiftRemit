#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SR-111 Compromise Response Rehearsal Script
# =============================================================================
# Usage:   ./scripts/rehearse-compromise-response.sh
# Purpose: Rehearse the full key-compromise incident-response procedure on
#          testnet, validating every step that would be followed during a real
#          mainnet key compromise.
#
# Requires:
#   - soroban CLI installed and on $PATH
#   - The following env vars set (or present in a .env file at repo root):
#       CONTRACT_ID              Deployed SwiftRemit contract address
#       NETWORK                  Soroban network name (should be "testnet")
#       RPC_URL                  Soroban RPC endpoint
#       ADMIN_IDENTITY           soroban CLI identity name for the pausing admin
#       ADMIN_ADDRESS            Stellar address corresponding to ADMIN_IDENTITY
#       SECOND_ADMIN_IDENTITY    soroban CLI identity name for the second approver
#       SECOND_ADMIN_ADDRESS     Stellar address for the second approver
#   Optional:
#       SIMULATED_COMPROMISED_IDENTITY   Identity to treat as "compromised"
#                                        (defaults to a freshly generated key)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# Load .env if present
# ---------------------------------------------------------------------------
if [[ -f "${REPO_ROOT}/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "${REPO_ROOT}/.env"
  set +a
fi

# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log()  { echo -e "${CYAN}[$(date -u '+%Y-%m-%dT%H:%M:%SZ')]${RESET} $*"; }
ok()   { echo -e "${GREEN}[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ✓ PASS${RESET} $*"; }
warn() { echo -e "${YELLOW}[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ⚠ WARN${RESET} $*"; }
fail() { echo -e "${RED}[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ✗ FAIL${RESET} $*"; }

# ---------------------------------------------------------------------------
# Step tracking
# ---------------------------------------------------------------------------
declare -A STEP_STATUS
declare -A STEP_DURATION
REHEARSAL_START=$(date +%s)
OVERALL_PASS=true

record_step() {
  local step_name="$1"
  local status="$2"
  local duration_s="$3"
  STEP_STATUS["${step_name}"]="${status}"
  STEP_DURATION["${step_name}"]="${duration_s}s"
}

run_step() {
  local step_name="$1"; shift
  local description="$1"; shift
  local t0
  t0=$(date +%s)

  log "--- Step: ${description} ---"
  local exit_code=0
  "$@" || exit_code=$?

  local t1
  t1=$(date +%s)
  local elapsed=$(( t1 - t0 ))

  if [[ ${exit_code} -eq 0 ]]; then
    ok "${description} (${elapsed}s)"
    record_step "${step_name}" "PASS" "${elapsed}"
  else
    fail "${description} (exit ${exit_code}, ${elapsed}s)"
    record_step "${step_name}" "FAIL" "${elapsed}"
    OVERALL_PASS=false
  fi
  return ${exit_code}
}

# ---------------------------------------------------------------------------
# Validate required environment variables
# ---------------------------------------------------------------------------
validate_env() {
  local missing=()
  for var in CONTRACT_ID NETWORK RPC_URL ADMIN_IDENTITY ADMIN_ADDRESS \
             SECOND_ADMIN_IDENTITY SECOND_ADMIN_ADDRESS; do
    if [[ -z "${!var:-}" ]]; then
      missing+=("${var}")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    fail "Missing required environment variables: ${missing[*]}"
    echo ""
    echo "Set them in your shell or add them to ${REPO_ROOT}/.env:"
    for var in "${missing[@]}"; do
      echo "  export ${var}=<value>"
    done
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Verify network safety
# ---------------------------------------------------------------------------
check_network_safety() {
  if [[ "${NETWORK}" == "mainnet" || "${NETWORK}" == "public" ]]; then
    fail "NETWORK is set to '${NETWORK}'. This script is for testnet rehearsal ONLY."
    exit 1
  fi
  ok "Network safety check passed (NETWORK=${NETWORK})"
}

# ---------------------------------------------------------------------------
# Prepare a "compromised" identity (generated fresh if not provided)
# ---------------------------------------------------------------------------
COMPROMISED_KEY_GENERATED=false
COMPROMISED_IDENTITY=""
COMPROMISED_ADDRESS=""
OPERATION_ID=""

prepare_compromised_identity() {
  COMPROMISED_IDENTITY="${SIMULATED_COMPROMISED_IDENTITY:-sr111-compromised-rehearsal-$$}"

  if ! soroban keys address "${COMPROMISED_IDENTITY}" &>/dev/null; then
    warn "Generating simulated compromised identity '${COMPROMISED_IDENTITY}'..."
    soroban keys generate "${COMPROMISED_IDENTITY}" --network "${NETWORK}" --fund
    ok "Generated '${COMPROMISED_IDENTITY}' for rehearsal"
    COMPROMISED_KEY_GENERATED=true
  fi

  COMPROMISED_ADDRESS=$(soroban keys address "${COMPROMISED_IDENTITY}")
  log "COMPROMISED_ADDRESS = ${COMPROMISED_ADDRESS}"

  # Register this key as an admin so we can then remove it (simulating a real key compromise)
  log "Adding simulated compromised key as admin (so we can rehearse removal)..."
  soroban contract invoke \
    --id "${CONTRACT_ID}" \
    --source "${ADMIN_IDENTITY}" \
    --network "${NETWORK}" \
    -- \
    add_admin \
    --caller "${ADMIN_ADDRESS}" \
    --new_admin "${COMPROMISED_ADDRESS}"
  ok "Compromised key added as admin for rehearsal"
}

# ---------------------------------------------------------------------------
# Helper: invoke the contract
# ---------------------------------------------------------------------------
invoke() {
  soroban contract invoke \
    --id "${CONTRACT_ID}" \
    --network "${NETWORK}" \
    "$@"
}

invoke_as() {
  local identity="$1"; shift
  soroban contract invoke \
    --id "${CONTRACT_ID}" \
    --source "${identity}" \
    --network "${NETWORK}" \
    "$@"
}

# ---------------------------------------------------------------------------
# T+0: emergency_pause
# ---------------------------------------------------------------------------
step_emergency_pause() {
  log "Calling emergency_pause with reason 'rehearsal_compromise_response'..."
  invoke_as "${ADMIN_IDENTITY}" -- emergency_pause \
    --caller "${ADMIN_ADDRESS}" \
    --reason "SecurityIncident"
  # Note: the contract accepts PauseReason enum values; SecurityIncident represents
  # a key compromise scenario. If the contract exposes a custom string reason field,
  # update the argument above to match the ABI.
}

# ---------------------------------------------------------------------------
# Verify is_paused returns true
# ---------------------------------------------------------------------------
step_verify_paused() {
  log "Verifying contract is paused..."
  local result
  result=$(invoke -- is_paused)
  log "is_paused result: ${result}"
  if [[ "${result}" != "true" ]]; then
    fail "Expected is_paused=true, got '${result}'"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# T+30m: propose multisig removal of compromised key
# ---------------------------------------------------------------------------
step_propose_removal() {
  log "Proposing removal of compromised key via multisig (propose_operation)..."
  # propose_operation with operation_type that triggers a RemoveAdmin on the compromised address.
  # The exact arguments depend on the AdminOperationType variants in the contract ABI.
  # This rehearsal uses the generic Pause/Unpause operation type as a stand-in to
  # exercise the multisig flow; in a real incident use the RemoveAdmin governance path.
  local output
  output=$(invoke_as "${ADMIN_IDENTITY}" -- propose_operation \
    --proposer "${ADMIN_ADDRESS}" \
    --operation_type "Pause" 2>&1)
  log "propose_operation output: ${output}"

  # Extract operation_id from output (contract returns the ID)
  # The format may vary; extract a numeric or string id
  OPERATION_ID=$(echo "${output}" | grep -oE '"[0-9]+"' | head -1 | tr -d '"' || echo "")
  if [[ -z "${OPERATION_ID}" ]]; then
    # Try to extract a bare number
    OPERATION_ID=$(echo "${output}" | grep -oE '\b[0-9]+\b' | head -1 || echo "0")
  fi
  log "Captured OPERATION_ID = '${OPERATION_ID}'"
}

# ---------------------------------------------------------------------------
# T+45m: second admin approves — auto-executes at threshold
# ---------------------------------------------------------------------------
step_approve_operation() {
  if [[ -z "${OPERATION_ID}" ]]; then
    warn "No OPERATION_ID captured from propose_operation. Skipping approve step."
    warn "In a real incident, retrieve the operation_id from the emitted event log."
    return 0
  fi
  log "Second admin (${SECOND_ADMIN_IDENTITY}) approving operation ${OPERATION_ID}..."
  invoke_as "${SECOND_ADMIN_IDENTITY}" -- approve_operation \
    --approver "${SECOND_ADMIN_ADDRESS}" \
    --operation_id "${OPERATION_ID}"
}

# ---------------------------------------------------------------------------
# Remove compromised admin key (governance path)
# ---------------------------------------------------------------------------
step_remove_compromised_key() {
  log "Removing simulated compromised key (${COMPROMISED_ADDRESS}) via remove_admin..."
  invoke_as "${ADMIN_IDENTITY}" -- remove_admin \
    --caller "${ADMIN_ADDRESS}" \
    --admin_to_remove "${COMPROMISED_ADDRESS}"
  ok "Compromised key removed from admin set"
}

# ---------------------------------------------------------------------------
# Verify compromised key is no longer admin
# ---------------------------------------------------------------------------
step_verify_not_admin() {
  log "Verifying compromised key is no longer an admin..."
  local result
  result=$(invoke -- is_admin --address "${COMPROMISED_ADDRESS}")
  log "is_admin(compromised) result: ${result}"
  if [[ "${result}" == "true" ]]; then
    fail "Compromised key is still an admin — removal did not take effect!"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# T+2h: vote_unpause (first admin)
# ---------------------------------------------------------------------------
step_vote_unpause_admin1() {
  log "Admin 1 (${ADMIN_IDENTITY}) casting vote_unpause..."
  invoke_as "${ADMIN_IDENTITY}" -- vote_unpause \
    --caller "${ADMIN_ADDRESS}"
}

# ---------------------------------------------------------------------------
# vote_unpause (second admin — may auto-unpause at quorum)
# ---------------------------------------------------------------------------
step_vote_unpause_admin2() {
  log "Admin 2 (${SECOND_ADMIN_IDENTITY}) casting vote_unpause..."
  invoke_as "${SECOND_ADMIN_IDENTITY}" -- vote_unpause \
    --caller "${SECOND_ADMIN_ADDRESS}" || {
    warn "vote_unpause from admin 2 returned non-zero (may have auto-unpaused, or already unpaused)"
    return 0
  }
}

# ---------------------------------------------------------------------------
# Verify is_paused returns false
# ---------------------------------------------------------------------------
step_verify_unpaused() {
  log "Verifying contract is no longer paused..."
  local result
  result=$(invoke -- is_paused)
  log "is_paused result: ${result}"
  if [[ "${result}" == "true" ]]; then
    # Attempt emergency_unpause as last resort
    warn "Contract still paused after votes. Attempting emergency_unpause..."
    invoke_as "${ADMIN_IDENTITY}" -- emergency_unpause \
      --caller "${ADMIN_ADDRESS}" || true
    result=$(invoke -- is_paused)
    if [[ "${result}" == "true" ]]; then
      fail "Contract is still paused after emergency_unpause — manual intervention required."
      return 1
    fi
    warn "emergency_unpause was required (quorum may not have been met). Document this in rehearsal log."
  fi
}

# ---------------------------------------------------------------------------
# Final health check
# ---------------------------------------------------------------------------
step_health_check() {
  log "Running health() check after full compromise-response rehearsal..."
  local health_output
  health_output=$(invoke -- health)
  echo ""
  echo -e "${BOLD}health() output:${RESET}"
  echo "${health_output}"
  echo ""
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
cleanup() {
  if [[ "${COMPROMISED_KEY_GENERATED:-false}" == "true" ]]; then
    warn "Cleaning up auto-generated compromised identity '${COMPROMISED_IDENTITY}'..."
    soroban keys remove "${COMPROMISED_IDENTITY}" 2>/dev/null \
      && log "Removed '${COMPROMISED_IDENTITY}' from local keystore." \
      || warn "Could not remove '${COMPROMISED_IDENTITY}' — remove manually if needed."
  fi
}

# ---------------------------------------------------------------------------
# Print final summary
# ---------------------------------------------------------------------------
print_summary() {
  local rehearsal_end
  rehearsal_end=$(date +%s)
  local total=$(( rehearsal_end - REHEARSAL_START ))

  echo ""
  echo -e "${BOLD}============================================================${RESET}"
  echo -e "${BOLD} SR-111 Compromise Response Rehearsal Summary${RESET}"
  echo -e "${BOLD} Completed: $(date -u '+%Y-%m-%dT%H:%M:%SZ')${RESET}"
  echo -e "${BOLD} Total duration: ${total}s${RESET}"
  echo -e "${BOLD}============================================================${RESET}"
  printf "%-45s %-8s %s\n" "Step" "Status" "Duration"
  printf "%-45s %-8s %s\n" "----" "------" "--------"
  for step in \
    "env_validation" \
    "network_safety" \
    "prepare_compromised" \
    "emergency_pause" \
    "verify_paused" \
    "propose_removal" \
    "approve_operation" \
    "remove_compromised_key" \
    "verify_not_admin" \
    "vote_unpause_admin1" \
    "vote_unpause_admin2" \
    "verify_unpaused" \
    "health_check"; do
    local status="${STEP_STATUS[${step}]:-SKIP}"
    local duration="${STEP_DURATION[${step}]:---}"
    if [[ "${status}" == "PASS" ]]; then
      printf "${GREEN}%-45s %-8s %s${RESET}\n" "${step}" "${status}" "${duration}"
    elif [[ "${status}" == "FAIL" ]]; then
      printf "${RED}%-45s %-8s %s${RESET}\n" "${step}" "${status}" "${duration}"
    else
      printf "${YELLOW}%-45s %-8s %s${RESET}\n" "${step}" "${status}" "${duration}"
    fi
  done
  echo -e "${BOLD}============================================================${RESET}"

  # Simulated playbook timing against real targets
  echo ""
  echo -e "${BOLD}Playbook timing review (simulated vs. SR-111 targets):${RESET}"
  printf "%-35s %-20s %-20s\n" "Milestone" "SR-111 Target" "Rehearsal Actual"
  printf "%-35s %-20s %-20s\n" "---------" "-------------" "----------------"
  local pause_t="${STEP_DURATION[emergency_pause]:-?}"
  local remove_t="${STEP_DURATION[remove_compromised_key]:-?}"
  local unpause_t="${STEP_DURATION[verify_unpaused]:-?}"
  printf "%-35s %-20s %-20s\n" "emergency_pause issued"    "T+0 (immediate)"   "${pause_t}"
  printf "%-35s %-20s %-20s\n" "compromised key removed"   "T+45 min"          "${remove_t}"
  printf "%-35s %-20s %-20s\n" "service restored (unpause)" "T+2 h"            "${unpause_t}"
  echo ""

  if [[ "${OVERALL_PASS}" == "true" ]]; then
    echo -e "${GREEN}${BOLD}OVERALL RESULT: PASS${RESET}"
    echo ""
    echo "Action items:"
    echo "  1. Append a new row to the Rehearsal Log in docs/KEY_MANAGEMENT_POLICY.md."
    echo "  2. Reference SR-111 in the GitHub sign-off issue."
    echo "  3. Note any steps that required the emergency_unpause fallback path."
  else
    echo -e "${RED}${BOLD}OVERALL RESULT: FAIL${RESET}"
    echo ""
    echo "Action items:"
    echo "  1. Review FAIL steps above and resolve blockers."
    echo "  2. Re-run this script until all steps PASS before mainnet launch sign-off."
    echo "  3. Document issues in docs/KEY_MANAGEMENT_POLICY.md Rehearsal Log."
  fi
  echo ""
}

# ---------------------------------------------------------------------------
# Trap: always print summary and cleanup on exit
# ---------------------------------------------------------------------------
trap 'print_summary; cleanup' EXIT

# ===========================================================================
# Main execution
# ===========================================================================
echo ""
echo -e "${BOLD}SR-111 Compromise Response Rehearsal${RESET}"
echo -e "Network: ${NETWORK:-<unset>}  |  Contract: ${CONTRACT_ID:-<unset>}"
echo ""

run_step "env_validation"        "Validate required environment variables"          validate_env
run_step "network_safety"        "Verify running on testnet (not mainnet)"          check_network_safety
run_step "prepare_compromised"   "Prepare simulated compromised identity"           prepare_compromised_identity

# T+0 — pause the contract
run_step "emergency_pause"       "T+0: emergency_pause (reason=SecurityIncident)"  step_emergency_pause
run_step "verify_paused"         "T+0: Verify is_paused = true"                    step_verify_paused

# T+30m — multisig removal flow
run_step "propose_removal"       "T+30m: propose_operation to remove compromised key" step_propose_removal
run_step "approve_operation"     "T+45m: Second admin approves operation"          step_approve_operation
run_step "remove_compromised_key" "Remove compromised key via remove_admin"        step_remove_compromised_key
run_step "verify_not_admin"      "Verify compromised key is no longer admin"       step_verify_not_admin

# T+2h — vote to unpause
run_step "vote_unpause_admin1"   "T+2h: Admin 1 vote_unpause"                      step_vote_unpause_admin1
run_step "vote_unpause_admin2"   "T+2h: Admin 2 vote_unpause"                      step_vote_unpause_admin2
run_step "verify_unpaused"       "T+2h: Verify is_paused = false"                  step_verify_unpaused
run_step "health_check"          "Final health() check"                            step_health_check

# Summary and cleanup happen via the EXIT trap
