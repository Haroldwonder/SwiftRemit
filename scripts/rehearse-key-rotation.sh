#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SR-111 Testnet Key Rotation Rehearsal Script
# =============================================================================
# Usage:   ./scripts/rehearse-key-rotation.sh
# Purpose: Rehearse the full admin key rotation procedure on testnet, validating
#          every step that would be followed during a real mainnet rotation.
#
# Requires:
#   - soroban CLI installed and on $PATH
#   - The following env vars set (or present in a .env file at repo root):
#       CONTRACT_ID              Deployed SwiftRemit contract address
#       NETWORK                  Soroban network name (should be "testnet" for rehearsal)
#       RPC_URL                  Soroban RPC endpoint
#       CURRENT_ADMIN_IDENTITY   soroban CLI identity name for the current admin
#       NEW_ADMIN_IDENTITY       soroban CLI identity name for the replacement admin
#
# The script generates NEW_ADMIN_IDENTITY on testnet if it does not already exist.
# It never touches mainnet keys.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# Load .env if present (silently; do not fail if absent)
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
# Track step durations for the summary
# ---------------------------------------------------------------------------
declare -A STEP_STATUS
declare -A STEP_DURATION
REHEARSAL_START=$(date +%s)
OVERALL_PASS=true

record_step() {
  local step_name="$1"
  local status="$2"      # PASS | FAIL
  local duration_s="$3"
  STEP_STATUS["${step_name}"]="${status}"
  STEP_DURATION["${step_name}"]="${duration_s}s"
}

run_step() {
  # run_step <step_name> <description> <command...>
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
  for var in CONTRACT_ID NETWORK RPC_URL CURRENT_ADMIN_IDENTITY NEW_ADMIN_IDENTITY; do
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
# Verify network safety: refuse to run against mainnet
# ---------------------------------------------------------------------------
check_network_safety() {
  if [[ "${NETWORK}" == "mainnet" || "${NETWORK}" == "public" ]]; then
    fail "NETWORK is set to '${NETWORK}'. This script is for testnet rehearsal ONLY."
    fail "Set NETWORK=testnet and retry."
    exit 1
  fi
  ok "Network safety check passed (NETWORK=${NETWORK})"
}

# ---------------------------------------------------------------------------
# Resolve addresses from identity names
# ---------------------------------------------------------------------------
resolve_addresses() {
  log "Resolving Stellar addresses from soroban identities..."

  CURRENT_ADMIN_ADDRESS=$(soroban keys address "${CURRENT_ADMIN_IDENTITY}" 2>/dev/null) || {
    fail "Cannot resolve address for identity '${CURRENT_ADMIN_IDENTITY}'. Is it registered in soroban CLI?"
    exit 1
  }
  log "CURRENT_ADMIN_ADDRESS = ${CURRENT_ADMIN_ADDRESS}"

  # If the new identity does not yet exist, generate it on testnet
  if ! soroban keys address "${NEW_ADMIN_IDENTITY}" &>/dev/null; then
    warn "Identity '${NEW_ADMIN_IDENTITY}' not found. Generating a fresh testnet keypair..."
    soroban keys generate "${NEW_ADMIN_IDENTITY}" --network "${NETWORK}" --fund
    ok "Generated and funded '${NEW_ADMIN_IDENTITY}' on testnet"
    NEW_KEY_GENERATED=true
  else
    NEW_KEY_GENERATED=false
  fi

  NEW_ADMIN_ADDRESS=$(soroban keys address "${NEW_ADMIN_IDENTITY}")
  log "NEW_ADMIN_ADDRESS = ${NEW_ADMIN_ADDRESS}"
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
# Step 2: propose_admin
# ---------------------------------------------------------------------------
step_propose_admin() {
  log "Proposing ${NEW_ADMIN_ADDRESS} as successor admin..."
  invoke_as "${CURRENT_ADMIN_IDENTITY}" -- propose_admin \
    --new_admin "${NEW_ADMIN_ADDRESS}"
}

# ---------------------------------------------------------------------------
# Step 3: accept_admin
# ---------------------------------------------------------------------------
step_accept_admin() {
  log "New admin (${NEW_ADMIN_IDENTITY}) accepting the proposal..."
  invoke_as "${NEW_ADMIN_IDENTITY}" -- accept_admin
}

# ---------------------------------------------------------------------------
# Step 4a: verify is_admin returns true for new key
# ---------------------------------------------------------------------------
step_verify_is_admin() {
  log "Verifying is_admin returns true for new address..."
  local result
  result=$(invoke -- is_admin --address "${NEW_ADMIN_ADDRESS}")
  log "is_admin result: ${result}"
  if [[ "${result}" != "true" ]]; then
    fail "is_admin returned '${result}' — expected 'true'"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Step 4b: print the full admin list
# ---------------------------------------------------------------------------
step_get_admin_list() {
  log "Fetching full admin list..."
  invoke -- get_admin_list
}

# ---------------------------------------------------------------------------
# Step 5: remove old key
# ---------------------------------------------------------------------------
step_remove_old_admin() {
  log "Removing old admin key (${CURRENT_ADMIN_ADDRESS})..."
  invoke_as "${NEW_ADMIN_IDENTITY}" -- remove_admin \
    --caller "${NEW_ADMIN_ADDRESS}" \
    --admin_to_remove "${CURRENT_ADMIN_ADDRESS}"
}

# ---------------------------------------------------------------------------
# Step 6: verify admin count
# ---------------------------------------------------------------------------
step_verify_admin_count() {
  log "Verifying admin count after removal..."
  local count
  count=$(invoke -- get_admin_count)
  log "Admin count: ${count}"
  if [[ "${count}" -lt 1 ]]; then
    fail "Admin count is ${count} — contract would be locked out!"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Health check: print health() JSON
# ---------------------------------------------------------------------------
step_health_check() {
  log "Running health() check..."
  local health_output
  health_output=$(invoke -- health)
  echo ""
  echo -e "${BOLD}health() output:${RESET}"
  echo "${health_output}"
  echo ""
  # Basic sanity: confirm paused is false
  if echo "${health_output}" | grep -q '"paused":true'; then
    fail "Contract reports paused=true after rotation — unexpected!"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Cleanup: remove generated test keys
# ---------------------------------------------------------------------------
cleanup() {
  if [[ "${NEW_KEY_GENERATED:-false}" == "true" ]]; then
    warn "Cleaning up auto-generated test identity '${NEW_ADMIN_IDENTITY}'..."
    # Remove from soroban keystore (best effort — do not fail the script)
    soroban keys remove "${NEW_ADMIN_IDENTITY}" 2>/dev/null \
      && log "Removed identity '${NEW_ADMIN_IDENTITY}' from local keystore." \
      || warn "Could not remove '${NEW_ADMIN_IDENTITY}' — remove manually if needed."
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
  echo -e "${BOLD} SR-111 Key Rotation Rehearsal Summary${RESET}"
  echo -e "${BOLD} Completed: $(date -u '+%Y-%m-%dT%H:%M:%SZ')${RESET}"
  echo -e "${BOLD} Total duration: ${total}s${RESET}"
  echo -e "${BOLD}============================================================${RESET}"
  printf "%-40s %-8s %s\n" "Step" "Status" "Duration"
  printf "%-40s %-8s %s\n" "----" "------" "--------"
  for step in \
    "env_validation" \
    "network_safety" \
    "propose_admin" \
    "accept_admin" \
    "verify_is_admin" \
    "get_admin_list" \
    "remove_old_admin" \
    "verify_admin_count" \
    "health_check"; do
    local status="${STEP_STATUS[${step}]:-SKIP}"
    local duration="${STEP_DURATION[${step}]:---}"
    if [[ "${status}" == "PASS" ]]; then
      printf "${GREEN}%-40s %-8s %s${RESET}\n" "${step}" "${status}" "${duration}"
    elif [[ "${status}" == "FAIL" ]]; then
      printf "${RED}%-40s %-8s %s${RESET}\n" "${step}" "${status}" "${duration}"
    else
      printf "${YELLOW}%-40s %-8s %s${RESET}\n" "${step}" "${status}" "${duration}"
    fi
  done
  echo -e "${BOLD}============================================================${RESET}"

  if [[ "${OVERALL_PASS}" == "true" ]]; then
    echo -e "${GREEN}${BOLD}OVERALL RESULT: PASS${RESET}"
    echo ""
    echo "Action items:"
    echo "  1. Append a new row to the Rehearsal Log in docs/KEY_MANAGEMENT_POLICY.md"
    echo "     with today's date, participants, outcome=PASS, and issues found (if any)."
    echo "  2. Reference SR-111 in the GitHub sign-off issue."
  else
    echo -e "${RED}${BOLD}OVERALL RESULT: FAIL${RESET}"
    echo ""
    echo "Action items:"
    echo "  1. Review FAIL steps above and resolve blockers."
    echo "  2. Re-run this script until all steps PASS before signing off."
    echo "  3. Document issues found in docs/KEY_MANAGEMENT_POLICY.md Rehearsal Log."
  fi
  echo ""
}

# ---------------------------------------------------------------------------
# Trap: always print summary and run cleanup, even on error
# ---------------------------------------------------------------------------
trap 'print_summary; cleanup' EXIT

# ===========================================================================
# Main execution
# ===========================================================================
echo ""
echo -e "${BOLD}SR-111 Testnet Key Rotation Rehearsal${RESET}"
echo -e "Network: ${NETWORK:-<unset>}  |  Contract: ${CONTRACT_ID:-<unset>}"
echo ""

# Validate environment before doing anything
run_step "env_validation"   "Validate required environment variables" validate_env
run_step "network_safety"   "Verify running on testnet (not mainnet)" check_network_safety
                            resolve_addresses

# Run the rotation steps
run_step "propose_admin"    "Step 2: Propose admin transfer"          step_propose_admin
run_step "accept_admin"     "Step 3: New admin accepts"               step_accept_admin
run_step "verify_is_admin"  "Step 4a: Verify new key is admin"        step_verify_is_admin
run_step "get_admin_list"   "Step 4b: Print admin list"               step_get_admin_list
run_step "remove_old_admin" "Step 5: Remove old admin key"            step_remove_old_admin
run_step "verify_admin_count" "Step 6: Verify admin count"            step_verify_admin_count
run_step "health_check"     "Health check: print health() JSON"       step_health_check

# Summary and cleanup happen via the EXIT trap
