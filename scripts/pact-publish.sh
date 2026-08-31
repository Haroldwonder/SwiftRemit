#!/usr/bin/env bash
# SR-216 — publish a generated consumer pact to the Pact Broker.
#
# Usage: scripts/pact-publish.sh <ConsumerName>
#   e.g. scripts/pact-publish.sh SwiftRemitFrontend
#
# Reads:
#   PACT_BROKER_BASE_URL  (required)  base URL of the broker / PactFlow account
#   PACT_BROKER_TOKEN     (optional)  bearer token for the broker
#   GITHUB_SHA            (optional)  consumer application version (defaults to `git rev-parse HEAD`)
#   GITHUB_REF_NAME       (optional)  branch name to tag the pact with
#
# No-ops (exit 0) when PACT_BROKER_BASE_URL is empty so callers can invoke it
# unconditionally.

set -euo pipefail

CONSUMER="${1:?usage: pact-publish.sh <ConsumerName>}"

if [ -z "${PACT_BROKER_BASE_URL:-}" ]; then
  echo "PACT_BROKER_BASE_URL not set — skipping pact publish for ${CONSUMER} (SR-216)."
  exit 0
fi

PACT_FILE="pacts/${CONSUMER}-SwiftRemitAPI.json"
if [ ! -f "$PACT_FILE" ]; then
  echo "❌ ${PACT_FILE} not found — did the consumer test run?" >&2
  exit 1
fi

VERSION="${GITHUB_SHA:-$(git rev-parse HEAD)}"
BRANCH="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"

IMAGE="pactfoundation/pact-cli:latest"

docker run --rm \
  -v "$PWD/pacts:/pacts:ro" \
  -e PACT_BROKER_BASE_URL \
  -e PACT_BROKER_TOKEN \
  "$IMAGE" \
  pact-broker publish "/pacts/${CONSUMER}-SwiftRemitAPI.json" \
  --consumer-app-version "$VERSION" \
  --branch "$BRANCH" \
  --broker-base-url "$PACT_BROKER_BASE_URL" \
  ${PACT_BROKER_TOKEN:+--broker-token "$PACT_BROKER_TOKEN"}

echo "✅ Published ${CONSUMER} pact @ ${VERSION} (branch ${BRANCH}) to ${PACT_BROKER_BASE_URL}"
