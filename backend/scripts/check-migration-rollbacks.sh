#!/usr/bin/env bash
# check-migration-rollbacks.sh (SR-036)
#
# Verifies that every *.sql migration file in backend/migrations/ has a
# matching *.down.sql rollback file.  Exits 1 (failing CI) when any are
# missing so a new migration cannot be merged without its rollback.
#
# Usage:
#   ./scripts/check-migration-rollbacks.sh
#   # or, from the repo root:
#   bash backend/scripts/check-migration-rollbacks.sh

set -euo pipefail

MIGRATIONS_DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"

missing=()

for up_file in "$MIGRATIONS_DIR"/*.sql; do
  # Skip .down.sql files — they are the rollbacks, not the migrations
  [[ "$up_file" == *.down.sql ]] && continue

  filename="$(basename "$up_file")"
  down_file="${up_file%.sql}.down.sql"

  if [[ ! -f "$down_file" ]]; then
    missing+=("$filename")
  fi
done

if [[ ${#missing[@]} -eq 0 ]]; then
  echo "✓ All migrations have a rollback file."
  exit 0
fi

echo "✗ The following migration(s) are missing a .down.sql rollback file:" >&2
for f in "${missing[@]}"; do
  echo "    migrations/$f  →  missing: ${f%.sql}.down.sql" >&2
done
echo "" >&2
echo "Create the missing rollback file(s) before merging." >&2
echo "If the rollback destroys data, annotate it with: -- DESTRUCTIVE" >&2
exit 1
