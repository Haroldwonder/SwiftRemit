#!/usr/bin/env bash
# scripts/reproducible-build.sh — SR-107
#
# Builds a deterministic swiftremit.wasm using docker/Dockerfile.reproducible.
# Extracts the artifact to build/reproducible/ and prints the SHA-256.
#
# Usage:
#   bash scripts/reproducible-build.sh [--tag custom-tag]
#
# Output:
#   build/reproducible/swiftremit.wasm       — optimised WASM artifact
#   build/reproducible/swiftremit.wasm.sha256 — SHA-256 of the artifact
#
# Environment variables (all optional):
#   RUST_VERSION       – Rust toolchain version (default: stable)
#   BINARYEN_VERSION   – binaryen version for wasm-opt (default: 116)
#   STELLAR_CLI_VERSION – stellar CLI version (default: 21.3.0)
#   DOCKER_IMAGE_TAG   – Docker image tag (default: swiftremit-repro:$(git rev-parse --short HEAD))

set -euo pipefail

log()  { echo "[reproducible-build] $*"; }
err()  { echo "[reproducible-build] ERROR: $*" >&2; }
fail() { err "$*"; exit 1; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v docker &>/dev/null || fail "Docker is required — install Docker and try again."

# ── Configuration ─────────────────────────────────────────────────────────────
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SHORT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo "local")"

RUST_VERSION="${RUST_VERSION:-stable}"
BINARYEN_VERSION="${BINARYEN_VERSION:-116}"
STELLAR_CLI_VERSION="${STELLAR_CLI_VERSION:-21.3.0}"
IMAGE_TAG="${DOCKER_IMAGE_TAG:-swiftremit-repro:${SHORT_SHA}}"
OUTPUT_DIR="$REPO_ROOT/build/reproducible"

# Parse CLI args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) IMAGE_TAG="$2"; shift 2 ;;
    *) err "Unknown argument: $1"; exit 1 ;;
  esac
done

log "Reproducible build"
log "  Repo root:    $REPO_ROOT"
log "  Git SHA:      $SHORT_SHA"
log "  Image tag:    $IMAGE_TAG"
log "  Rust version: $RUST_VERSION"
log "  Output dir:   $OUTPUT_DIR"

# ── Build ─────────────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR"

log "Building Docker image (--no-cache) …"
docker build \
  --no-cache \
  --file "$REPO_ROOT/docker/Dockerfile.reproducible" \
  --build-arg "RUST_VERSION=$RUST_VERSION" \
  --build-arg "BINARYEN_VERSION=$BINARYEN_VERSION" \
  --build-arg "STELLAR_CLI_VERSION=$STELLAR_CLI_VERSION" \
  --tag "$IMAGE_TAG" \
  "$REPO_ROOT"

# ── Extract artifact ──────────────────────────────────────────────────────────
log "Extracting WASM artifact from image…"

# Create a temporary container, copy the file out, then remove the container
CID=$(docker create "$IMAGE_TAG")
docker cp "${CID}:/out/swiftremit.wasm"       "$OUTPUT_DIR/swiftremit.wasm"
docker cp "${CID}:/out/swiftremit.wasm.sha256" "$OUTPUT_DIR/swiftremit.wasm.sha256"
docker rm "$CID" > /dev/null

# ── Compute and verify SHA-256 ────────────────────────────────────────────────
# Use sha256sum on Linux, shasum -a 256 on macOS
if command -v sha256sum &>/dev/null; then
  COMPUTED_SHA=$(sha256sum "$OUTPUT_DIR/swiftremit.wasm" | awk '{print $1}')
else
  COMPUTED_SHA=$(shasum -a 256 "$OUTPUT_DIR/swiftremit.wasm" | awk '{print $1}')
fi

EXTRACTED_SHA=$(cat "$OUTPUT_DIR/swiftremit.wasm.sha256" | tr -d '[:space:]')

echo ""
log "BUILD SHA256: $COMPUTED_SHA"
echo ""

# Cross-check that the extracted .sha256 file matches what we computed
if [ "$COMPUTED_SHA" != "$EXTRACTED_SHA" ]; then
  err "SHA-256 mismatch between extracted artifact and in-image hash!"
  err "  Computed:  $COMPUTED_SHA"
  err "  In-image:  $EXTRACTED_SHA"
  exit 1
fi

# Update the .sha256 file with the computed value (canonical source of truth)
echo "$COMPUTED_SHA" > "$OUTPUT_DIR/swiftremit.wasm.sha256"

log "Artifact: $OUTPUT_DIR/swiftremit.wasm ($(wc -c < "$OUTPUT_DIR/swiftremit.wasm") bytes)"
log "SHA-256:  $OUTPUT_DIR/swiftremit.wasm.sha256"
log "Done."
