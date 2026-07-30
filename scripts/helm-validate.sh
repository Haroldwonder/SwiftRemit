#!/usr/bin/env bash
#
# SR-103 — lint, render and validate the SwiftRemit Helm chart against every
# environment's value set. This is what CI runs; run it locally before touching
# charts/swiftremit so a template error is caught here rather than during a
# production deploy.
#
# Usage: ./scripts/helm-validate.sh   (or: make helm-lint)
#
# Optional tools, skipped with a notice when absent:
#   kubeconform  — validates rendered manifests against the Kubernetes schemas
#   helm unittest — runs charts/swiftremit/tests/*_test.yaml

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CHART="charts/swiftremit"
ENVIRONMENTS=(dev staging production)
KUBE_VERSION="${KUBE_VERSION:-1.29.0}"
OUT_DIR="${TMPDIR:-/tmp}/swiftremit-helm-render"

if ! command -v helm >/dev/null 2>&1; then
  echo "✗ helm is not installed — see https://helm.sh/docs/intro/install/" >&2
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

failures=0

echo "── helm lint ────────────────────────────────────────────────────────────"
for env in "${ENVIRONMENTS[@]}"; do
  echo "› $env"
  helm lint "$CHART" --strict -f "$CHART/values.$env.yaml"
done

echo ""
echo "── helm template ────────────────────────────────────────────────────────"
for env in "${ENVIRONMENTS[@]}"; do
  echo "› $env"
  helm template swiftremit "$CHART" \
    --namespace swiftremit \
    -f "$CHART/values.$env.yaml" >"$OUT_DIR/$env.yaml"
done

echo ""
echo "── rendered manifest checks (secrets, security contexts, resources) ─────"
for env in "${ENVIRONMENTS[@]}"; do
  if ! python3 scripts/check-rendered-manifests.py --label "$env" <"$OUT_DIR/$env.yaml"; then
    failures=$((failures + 1))
  fi
done

echo ""
echo "── kubeconform schema validation ────────────────────────────────────────"
if command -v kubeconform >/dev/null 2>&1; then
  for env in "${ENVIRONMENTS[@]}"; do
    echo "› $env"
    if ! kubeconform \
      -strict \
      -summary \
      -kubernetes-version "$KUBE_VERSION" \
      -schema-location default \
      -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json' \
      "$OUT_DIR/$env.yaml"; then
      failures=$((failures + 1))
    fi
  done
else
  echo "• kubeconform not installed — skipping (CI always runs it)"
fi

echo ""
echo "── helm unittest ────────────────────────────────────────────────────────"
if helm plugin list 2>/dev/null | grep -q '^unittest'; then
  if ! helm unittest "$CHART"; then
    failures=$((failures + 1))
  fi
else
  echo "• helm-unittest plugin not installed — skipping"
  echo "  install with: helm plugin install https://github.com/helm-unittest/helm-unittest --verify=false"
fi

echo ""
if [ "$failures" -gt 0 ]; then
  echo "✗ Helm chart validation failed ($failures step(s))" >&2
  exit 1
fi
echo "✓ Helm chart validation passed for: ${ENVIRONMENTS[*]}"
