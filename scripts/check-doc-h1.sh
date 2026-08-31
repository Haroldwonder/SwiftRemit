#!/usr/bin/env bash
# scripts/check-doc-h1.sh
#
# SR-219 — catch accidental document concatenation in docs/.
#
# docs/WEBHOOKS.md was once two separate documents pasted into one file, each
# with its own top-level "# " heading. A reader scrolling in from the middle
# had no way to tell which half was current. This check fails when any markdown
# file under docs/ has more than one H1 (`# ` at column 0), ignoring lines
# inside fenced code blocks (``` or ~~~), so shell comments like `# build` in a
# code sample don't trip it.
#
# Usage: bash scripts/check-doc-h1.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs"
FAILED=0
CHECKED=0

while IFS= read -r -d '' file; do
  CHECKED=$((CHECKED + 1))
  # Count "# " headings that sit outside fenced code blocks.
  read -r count first_lines < <(
    awk '
      /^(```|~~~)/ { infence = !infence; next }
      !infence && /^# / { n++; lines = lines (lines ? "," : "") NR }
      END { print n + 0, lines }
    ' "$file"
  )
  if [[ "$count" -gt 1 ]]; then
    rel="${file#"$REPO_ROOT"/}"
    echo "❌  $rel has $count top-level (# ) headings (lines: $first_lines)"
    echo "    A docs file must have exactly one H1. Demote the extra headings to"
    echo "    ## or split the file — this usually means two documents were"
    echo "    concatenated. See SR-219."
    FAILED=1
  fi
done < <(find "$DOCS_DIR" -type f -name '*.md' -print0)

if [[ $FAILED -eq 1 ]]; then
  exit 1
fi

echo "✅  Single-H1 check passed ($CHECKED docs/ markdown files)."
