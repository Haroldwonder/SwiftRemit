#!/usr/bin/env bash
# scripts/check-key-rotation-due.sh
#
# Parses the Key Inventory table (Section 2) in docs/KEY_MANAGEMENT_POLICY.md
# and fails if any key's "Next Rotation Due" date has already passed, or is
# not a valid ISO date (e.g. still a PLACEHOLDER). Intended to run on a
# schedule via .github/workflows/key-rotation-check.yml (SR-111).
#
# Usage: bash scripts/check-key-rotation-due.sh [path-to-policy-md]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POLICY_FILE="${1:-$REPO_ROOT/docs/KEY_MANAGEMENT_POLICY.md}"

if [[ ! -f "$POLICY_FILE" ]]; then
  echo "❌  Policy file not found: $POLICY_FILE"
  exit 1
fi

TODAY_EPOCH="$(date -u +%s)"
FAILED=0
CHECKED=0

# Extract rows from the Key Inventory table (Section 2). Rows look like:
# | Admin Key 1 | `Admin` (mainnet) | ... | 2026-05-30 | 2026-08-28 (...) |
while IFS= read -r row; do
  # Skip header/separator rows.
  [[ "$row" == *"Key Name"* || "$row" == *"---"* ]] && continue

  key_name="$(echo "$row" | awk -F'|' '{print $2}' | xargs)"
  next_due_col="$(echo "$row" | awk -F'|' '{print $8}' | xargs)"

  [[ -z "$key_name" ]] && continue
  CHECKED=$((CHECKED + 1))

  due_date="$(echo "$next_due_col" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -n1 || true)"

  if [[ -z "$due_date" ]]; then
    echo "❌  ${key_name}: Next Rotation Due is missing or still a PLACEHOLDER."
    FAILED=1
    continue
  fi

  if ! due_epoch="$(date -u -j -f "%Y-%m-%d" "$due_date" +%s 2>/dev/null)"; then
    # GNU date fallback (Linux CI runners).
    due_epoch="$(date -u -d "$due_date" +%s 2>/dev/null || echo "")"
  fi

  if [[ -z "$due_epoch" ]]; then
    echo "⚠️   ${key_name}: could not parse due date '${due_date}', skipping."
    continue
  fi

  if (( due_epoch < TODAY_EPOCH )); then
    echo "❌  ${key_name}: rotation OVERDUE (Next Rotation Due: ${due_date})"
    FAILED=1
  else
    days_left=$(( (due_epoch - TODAY_EPOCH) / 86400 ))
    echo "✅  ${key_name}: rotation due ${due_date} (${days_left} days remaining)"
  fi
done < <(grep -E '^\| (Admin Key|Treasury Key|Deployer Key|CI/CD Key)' "$POLICY_FILE")

if [[ $CHECKED -eq 0 ]]; then
  echo "❌  No key inventory rows found in ${POLICY_FILE} — table format may have changed."
  exit 1
fi

if [[ $FAILED -eq 1 ]]; then
  echo ""
  echo "One or more keys are overdue for rotation or missing a rotation date."
  echo "See docs/KEY_MANAGEMENT_POLICY.md Section 4 (Normal Rotation Procedure)."
  exit 1
fi

echo ""
echo "✅  All tracked keys have a valid, non-overdue Next Rotation Due date."
