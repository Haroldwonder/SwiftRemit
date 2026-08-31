#!/usr/bin/env bash
# SR-216 — gate a deploy on the Pact Broker's can-i-deploy check.
#
# Asks the broker whether SwiftRemitAPI at the given version has verified pacts
# for every consumer currently in the target environment. Fails (exit 1) if the
# broker says no.
#
# Usage: scripts/pact-can-i-deploy.sh <target-environment> [provider-version]
#   e.g. scripts/pact-can-i-deploy.sh staging "$GITHUB_SHA"
#
# Reads:
#   PACT_BROKER_BASE_URL  base URL of the broker / PactFlow account
#   PACT_BROKER_TOKEN     (optional) bearer token
#
# No-ops (exit 0, with a warning) when PACT_BROKER_BASE_URL is empty, so the gate
# is inert until a broker is stood up (SR-216).

set -euo pipefail

ENVIRONMENT="${1:?usage: pact-can-i-deploy.sh <target-environment> [provider-version]}"
VERSION="${2:-${GITHUB_SHA:-$(git rev-parse HEAD)}}"

if [ -z "${PACT_BROKER_BASE_URL:-}" ]; then
  echo "::warning::PACT_BROKER_BASE_URL not configured — skipping Pact can-i-deploy gate for '${ENVIRONMENT}' (SR-216)."
  exit 0
fi

IMAGE="pactfoundation/pact-cli:latest"

docker run --rm \
  -e PACT_BROKER_BASE_URL \
  -e PACT_BROKER_TOKEN \
  "$IMAGE" \
  pact-broker can-i-deploy \
  --pacticipant SwiftRemitAPI \
  --version "$VERSION" \
  --to-environment "$ENVIRONMENT" \
  --broker-base-url "$PACT_BROKER_BASE_URL" \
  ${PACT_BROKER_TOKEN:+--broker-token "$PACT_BROKER_TOKEN"} \
  --retry-while-unknown 6 \
  --retry-interval 10
