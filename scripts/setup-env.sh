#!/usr/bin/env bash
#
# SR-102 — create the per-service .env files the Docker Compose stack reads.
#
# The tracked .env.example files are templates only. Compose must never read
# them directly: they hold placeholders, so services would start with dummy
# configuration, and editing an example to make things work locally risks
# committing a real secret into a tracked file.
#
# This script copies each template to a gitignored .env (never overwriting an
# existing one) and replaces the placeholders that have a safe local-dev value,
# so `docker compose up` works immediately afterwards.
#
# Usage: ./scripts/setup-env.sh   (or: make setup)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVICES=(backend api frontend)

# Generate a random hex secret. Falls back to /dev/urandom when openssl is absent.
random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# set_var <file> <KEY> <VALUE> — replace KEY=... in place, or append if missing.
# Uses | as the sed delimiter so the / and : in URLs need no escaping; the values
# written here never contain |.
set_var() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file"
    rm -f "${file}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

created_any=0

for svc in "${SERVICES[@]}"; do
  example="${svc}/.env.example"
  target="${svc}/.env"

  if [ ! -f "$example" ]; then
    echo "✗ ${example} is missing — cannot create ${target}" >&2
    exit 1
  fi

  if [ -f "$target" ]; then
    echo "• ${target} already exists — left untouched"
    continue
  fi

  cp "$example" "$target"
  created_any=1
  echo "✓ created ${target} from ${example}"

  case "$svc" in
    backend)
      # Point at the Compose postgres service and give the local stack a real
      # (throwaway) admin secret instead of the SXXX... placeholder.
      set_var "$target" DATABASE_URL "postgres://swiftremit:swiftremit@postgres:5432/swiftremit"
      set_var "$target" PORT "3001"
      set_var "$target" ADMIN_SECRET_KEY "local-dev-$(random_secret)"
      ;;
    api)
      set_var "$target" DATABASE_URL "postgres://swiftremit:swiftremit@postgres:5432/swiftremit"
      set_var "$target" ANCHORS_ADMIN_API_KEY "local-dev-$(random_secret)"
      set_var "$target" JWT_SECRET "local-dev-$(random_secret)"
      ;;
    frontend)
      # Nothing to substitute — the frontend template holds no secrets.
      ;;
  esac
done

echo ""
if [ "$created_any" -eq 1 ]; then
  echo "Local environment ready. Next: docker compose up --build"
else
  echo "All .env files already present. Next: docker compose up --build"
fi
echo ""
echo "Contract-specific values (backend CONTRACT_ID, frontend VITE_CONTRACT_ID,"
echo "VITE_USDC_ISSUER) are still placeholders. Fill them in after deploying a"
echo "contract — see QUICK_START.md — or run ./setup-testnet.sh to generate them."
