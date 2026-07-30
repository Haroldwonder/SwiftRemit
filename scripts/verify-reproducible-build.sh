#!/usr/bin/env bash
# scripts/verify-reproducible-build.sh — SR-107
#
# Verifies that two independent clean builds of SwiftRemit produce the
# same WASM SHA-256 hash, and optionally compares against a published hash.
#
# Usage:
#   bash scripts/verify-reproducible-build.sh [--expected <sha256>]
#
# Options:
#   --expected <hash>  – also compare against this published hash
#                        (reads releases/latest-hash.txt if not supplied)
#
# Exit codes:
#   0  – reproducibility verified (and matches expected hash if supplied)
#   1  – hashes differ, or other error

set -euo pipefail

log()  { echo "[verify-reproducible] $*"; }
err()  { echo "[verify-reproducible] ERROR: $*" >&2; }
fail() { err "$*"; exit 1; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v docker &>/dev/null || fail "Docker is required — install Docker and try again."

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
BUILD_SCRIPT="$REPO_ROOT/scripts/reproducible-build.sh"

[ -f "$BUILD_SCRIPT" ] || fail "reproducible-build.sh not found at $BUILD_SCRIPT"

# ── Parse arguments ───────────────────────────────────────────────────────────
EXPECTED_HASH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --expected) EXPECTED_HASH="$2"; shift 2 ;;
    *) err "Unknown argument: $1"; exit 1 ;;
  esac
done

# If no expected hash supplied on CLI, try reading from releases/latest-hash.txt
if [ -z "$EXPECTED_HASH" ] && [ -f "$REPO_ROOT/releases/latest-hash.txt" ]; then
  EXPECTED_HASH=$(cat "$REPO_ROOT/releases/latest-hash.txt" | tr -d '[:space:]')
  log "Using published hash from releases/latest-hash.txt: $EXPECTED_HASH"
fi

# ── First independent build ───────────────────────────────────────────────────
log "=== Build 1/2 ==="
DOCKER_IMAGE_TAG="swiftremit-repro-verify-1:$(date +%s)" \
  bash "$BUILD_SCRIPT" --tag "swiftremit-repro-verify-1"

if command -v sha256sum &>/dev/null; then
  HASH1=$(sha256sum "$REPO_ROOT/build/reproducible/swiftremit.wasm" | awk '{print $1}')
else
  HASH1=$(shasum -a 256 "$REPO_ROOT/build/reproducible/swiftremit.wasm" | awk '{print $1}')
fi

# Save first build
cp "$REPO_ROOT/build/reproducible/swiftremit.wasm" \
   "$REPO_ROOT/build/reproducible/swiftremit.build1.wasm"

log "Build 1 SHA-256: $HASH1"

# ── Second independent build ──────────────────────────────────────────────────
log "=== Build 2/2 ==="
DOCKER_IMAGE_TAG="swiftremit-repro-verify-2:$(date +%s)" \
  bash "$BUILD_SCRIPT" --tag "swiftremit-repro-verify-2"

if command -v sha256sum &>/dev/null; then
  HASH2=$(sha256sum "$REPO_ROOT/build/reproducible/swiftremit.wasm" | awk '{print $1}')
else
  HASH2=$(shasum -a 256 "$REPO_ROOT/build/reproducible/swiftremit.wasm" | awk '{print $1}')
fi

log "Build 2 SHA-256: $HASH2"

# ── Compare the two builds ────────────────────────────────────────────────────
echo ""
log "=== Comparing builds ==="
log "Build 1: $HASH1"
log "Build 2: $HASH2"

if [ "$HASH1" != "$HASH2" ]; then
  err "REPRODUCIBILITY FAILURE: the two builds produced DIFFERENT WASM hashes."
  err "Build 1: $HASH1"
  err "Build 2: $HASH2"
  err ""
  err "Possible causes:"
  err "  - Timestamp embedded during build (check build.rs)"
  err "  - Non-deterministic dependency resolution (check Cargo.lock is committed)"
  err "  - Environment variable baked in at compile time"
  err "  - wasm-opt version differs between builds"
  exit 1
fi

log "REPRODUCIBILITY VERIFIED: both builds produce the same hash"
log "SHA-256: $HASH1"

# ── Compare against published hash ────────────────────────────────────────────
if [ -n "$EXPECTED_HASH" ]; then
  echo ""
  log "=== Comparing against published hash ==="
  log "Published: $EXPECTED_HASH"
  log "Built:     $HASH1"

  if [ "$HASH1" != "$EXPECTED_HASH" ]; then
    err "HASH MISMATCH against published/expected hash!"
    err "  Built:     $HASH1"
    err "  Expected:  $EXPECTED_HASH"
    err ""
    err "The built WASM does not match the published hash for this release."
    err "Do not deploy until this discrepancy is resolved."
    exit 1
  fi

  log "PUBLISHED HASH MATCHES: build is consistent with the published release hash ✓"
fi

echo ""
log "All checks passed."
log "REPRODUCIBILITY VERIFIED: $HASH1"
