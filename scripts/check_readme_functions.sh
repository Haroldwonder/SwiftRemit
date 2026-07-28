#!/usr/bin/env bash
# check_readme_functions.sh — Fail if a pub fn in the contract's #[contractimpl]
# block is missing from the README's "Contract Functions" section.
#
# Usage:
#   ./scripts/check_readme_functions.sh
#
# Extracts every `pub fn <name>` between the `#[contractimpl]` marker and the
# end of src/lib.rs (the whole file is a single impl block today), then
# checks each name appears at least once as `` `name( `` inside the
# "## Contract Functions" section of README.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LIB_RS="${REPO_ROOT}/src/lib.rs"
README="${REPO_ROOT}/README.md"

if [[ ! -f "${LIB_RS}" ]]; then
  echo "❌  ${LIB_RS} not found" >&2
  exit 1
fi

if [[ ! -f "${README}" ]]; then
  echo "❌  ${README} not found" >&2
  exit 1
fi

IMPL_LINE=$(grep -n "^impl SwiftRemitContract" "${LIB_RS}" | head -1 | cut -d: -f1)
if [[ -z "${IMPL_LINE}" ]]; then
  echo "❌  Could not locate 'impl SwiftRemitContract' in src/lib.rs" >&2
  exit 1
fi

# Isolate the README's "## Contract Functions" section (up to the next "## " heading).
README_SECTION=$(awk '
  /^## Contract Functions/ { capture=1 }
  capture && /^## / && !/^## Contract Functions/ { exit }
  capture { print }
' "${README}")

if [[ -z "${README_SECTION}" ]]; then
  echo "❌  Could not find a '## Contract Functions' section in README.md" >&2
  exit 1
fi

missing=()
while IFS=: read -r _ name; do
  name="$(echo "${name}" | sed -E 's/^ *pub fn *//; s/[(<].*//')"
  if ! grep -qF "\`${name}(" <<<"${README_SECTION}"; then
    missing+=("${name}")
  fi
done < <(tail -n +"${IMPL_LINE}" "${LIB_RS}" | grep -n "    pub fn ")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "❌  README.md's Contract Functions section is missing ${#missing[@]} function(s):" >&2
  for name in "${missing[@]}"; do
    echo "   - ${name}" >&2
  done
  echo "" >&2
  echo "   Add an entry (with description + auth) under '## Contract Functions' in README.md." >&2
  exit 1
fi

echo "✅  README.md documents every pub fn in the SwiftRemitContract impl block."
