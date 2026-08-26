#!/usr/bin/env bash
# scripts/check-root-markdown.sh
#
# Enforces that only the allowlisted markdown files exist at the repository
# root. Any other .md file triggers a non-zero exit so CI fails.
#
# Allowlist (SR-115):
#   README.md  CONTRIBUTING.md  SECURITY.md  CHANGELOG.md  ROADMAP.md  LICENSE
#
# Usage: bash scripts/check-root-markdown.sh

set -euo pipefail

ALLOWLIST=(
  "README.md"
  "CONTRIBUTING.md"
  "SECURITY.md"
  "CHANGELOG.md"
  "ROADMAP.md"
)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0

while IFS= read -r -d '' file; do
  name="$(basename "$file")"
  allowed=0
  for entry in "${ALLOWLIST[@]}"; do
    if [[ "$name" == "$entry" ]]; then
      allowed=1
      break
    fi
  done
  if [[ $allowed -eq 0 ]]; then
    echo "❌  Unexpected root-level markdown: $name"
    echo "   Move it to docs/ or delete it. Only these files are allowed at root:"
    for entry in "${ALLOWLIST[@]}"; do
      echo "     - $entry"
    done
    FAILED=1
  fi
done < <(find "$REPO_ROOT" -maxdepth 1 -name "*.md" -print0)

if [[ $FAILED -eq 1 ]]; then
  exit 1
fi

echo "✅  Root-level markdown check passed (${#ALLOWLIST[@]} allowed files)."
