#!/usr/bin/env bash
# Smoke tests run against the live staging environment after each deploy.
# Exits non-zero on any failure so the CI workflow marks the deploy as failed.
#
# Required environment variables:
#   STAGING_API_URL     – Base URL for the API service  (e.g. https://api.staging.swiftremit.io)
#   STAGING_BACKEND_URL – Base URL for the backend service (e.g. https://backend.staging.swiftremit.io)
set -euo pipefail

API="${STAGING_API_URL:-http://localhost:3000}"
BACKEND="${STAGING_BACKEND_URL:-http://localhost:3001}"
PASS=0
FAIL=0

check() {
  local label="$1"
  local url="$2"
  local expected_status="${3:-200}"

  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url" || echo "000")

  if [ "$status" = "$expected_status" ]; then
    echo "  PASS  $label ($status)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label — expected $expected_status, got $status  [$url]"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== SwiftRemit staging smoke tests ==="
echo "API:     $API"
echo "BACKEND: $BACKEND"
echo ""

echo "--- API health ---"
check "GET /health"                      "$API/health"
check "GET /api/currencies"              "$API/api/currencies"
check "GET /api/limits"                  "$API/api/limits"
check "GET /api/docs (OpenAPI UI)"       "$API/api/docs"

echo ""
echo "--- Backend health ---"
check "GET /health (backend)"            "$BACKEND/health"

echo ""
echo "--- 404 handling ---"
check "GET /nonexistent returns 404"     "$API/nonexistent" "404"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  echo "Smoke tests FAILED — $FAIL check(s) did not pass."
  exit 1
fi

echo "All smoke tests passed."
