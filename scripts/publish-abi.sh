#!/usr/bin/env bash
# publish-abi.sh — Extract contract ABI/metadata after mainnet deployment and
# update stellar.toml so Stellar Expert can index the contract.
#
# Usage:
#   ./scripts/publish-abi.sh <CONTRACT_ID> [network]
#
# Required env / args:
#   CONTRACT_ID   — deployed Soroban contract address (C...)
#   NETWORK       — "mainnet" (default) or "testnet"
#   STELLAR_CLI   — path to stellar/soroban CLI binary (default: stellar)
#
# Outputs:
#   abi/swiftremit.contract.json   — human-readable contract spec (JSON)
#   abi/swiftremit.wasm.hash       — SHA-256 hash of the deployed WASM
#   public/.well-known/stellar.toml — updated with CONTRACT_ID + WASM_HASH

set -euo pipefail

CONTRACT_ID="${1:-${CONTRACT_ID:-}}"
NETWORK="${2:-${NETWORK:-mainnet}}"
STELLAR="${STELLAR_CLI:-stellar}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ABI_DIR="${REPO_ROOT}/abi"
TOML_TEMPLATE="${REPO_ROOT}/public/.well-known/stellar.toml.template"
TOML_OUT="${REPO_ROOT}/public/.well-known/stellar.toml"

# ─── Validate inputs ──────────────────────────────────────────────────────────
if [[ -z "${CONTRACT_ID}" ]]; then
  echo "❌  CONTRACT_ID is required (pass as first argument or set env var)" >&2
  exit 1
fi

if ! command -v "${STELLAR}" &>/dev/null; then
  echo "❌  Stellar CLI not found at '${STELLAR}'. Install from https://github.com/stellar/stellar-cli" >&2
  exit 1
fi

mkdir -p "${ABI_DIR}"

echo "📋  Contract : ${CONTRACT_ID}"
echo "🌐  Network  : ${NETWORK}"

# ─── 1. Fetch contract spec (ABI) ─────────────────────────────────────────────
echo "⬇️   Fetching contract spec..."
"${STELLAR}" contract info interface \
  --contract-id "${CONTRACT_ID}" \
  --network "${NETWORK}" \
  --output json \
  > "${ABI_DIR}/swiftremit.contract.json"

echo "✅  ABI written to abi/swiftremit.contract.json"

# ─── 2. Fetch WASM hash ───────────────────────────────────────────────────────
echo "⬇️   Fetching WASM hash..."
WASM_HASH=$(
  "${STELLAR}" contract info wasm-hash \
    --contract-id "${CONTRACT_ID}" \
    --network "${NETWORK}" \
    2>/dev/null \
  || "${STELLAR}" contract fetch \
    --contract-id "${CONTRACT_ID}" \
    --network "${NETWORK}" \
    --output hash \
    2>/dev/null
)

if [[ -z "${WASM_HASH}" ]]; then
  echo "⚠️   Could not retrieve WASM hash — stellar.toml will use placeholder" >&2
  WASM_HASH="unknown"
fi

echo "${WASM_HASH}" > "${ABI_DIR}/swiftremit.wasm.hash"
echo "✅  WASM hash: ${WASM_HASH}"

# ─── 3. Derive contract version from Cargo.toml ───────────────────────────────
CONTRACT_VERSION=$(grep '^version' "${REPO_ROOT}/Cargo.toml" | head -1 | sed 's/.*"\(.*\)".*/\1/')
echo "📦  Contract version: ${CONTRACT_VERSION}"

# ─── 4. Render stellar.toml from template ─────────────────────────────────────
echo "📝  Updating stellar.toml..."
sed \
  -e "s|\${CONTRACT_ID}|${CONTRACT_ID}|g" \
  -e "s|\${WASM_HASH}|${WASM_HASH}|g" \
  -e "s|\${CONTRACT_VERSION}|${CONTRACT_VERSION}|g" \
  "${TOML_TEMPLATE}" > "${TOML_OUT}"

echo "✅  stellar.toml written to public/.well-known/stellar.toml"

# ─── 5. Summary ───────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════"
echo "  ABI publish complete"
echo "  Contract ID : ${CONTRACT_ID}"
echo "  WASM hash   : ${WASM_HASH}"
echo "  Version     : ${CONTRACT_VERSION}"
echo "════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Commit abi/ and public/.well-known/stellar.toml"
echo "  2. Deploy public/.well-known/stellar.toml to your home domain"
echo "  3. Stellar Expert will index the contract automatically once the"
echo "     TOML is reachable at https://<domain>/.well-known/stellar.toml"
