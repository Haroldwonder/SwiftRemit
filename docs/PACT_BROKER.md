# Pact Broker & can-i-deploy (SR-216)

Consumer-driven contract tests (Pact) protect the API from shipping a change that
breaks the frontend, SDK, or mobile client. Before SR-216 the generated pact
files were passed between jobs as CI artifacts and committed to `pacts/` on
`main`; there was no broker and no `can-i-deploy` gate, so a provider change that
broke a consumer contract was only caught if the same PR happened to update that
consumer's pact-generating test.

SR-216 introduces a **Pact Broker** as the source of truth and a **`can-i-deploy`
gate** on both deploy pipelines.

## What changed

| Area | Before | After |
|------|--------|-------|
| Consumer pacts | uploaded as CI artifacts only | also published to the broker, tagged by branch and commit SHA (`scripts/pact-publish.sh`) |
| Provider verification | reads downloaded artifacts | reads pacts from the broker by consumer-version selector and publishes the verification result back, keyed by the API commit SHA |
| `deploy-staging.yml` | no contract gate | `pact-can-i-deploy` job must pass before `deploy` |
| `deploy-mainnet.yml` | no contract gate | `gate-pact` runs after `require-checklist`, before `build-wasm` |
| `pacts/*.json` commit job | always ran on `main` | only runs while no broker is configured (fallback) |

Every broker interaction is **gated on the `PACT_BROKER_BASE_URL` repository
variable**. With it unset the pipeline behaves exactly as before (artifacts +
commit-to-`main`), so this change is safe to merge before the broker exists.

## Configuration

Set these on the repository (Settings → Secrets and variables → Actions):

| Name | Kind | Value |
|------|------|-------|
| `PACT_BROKER_BASE_URL` | variable | e.g. `https://<org>.pactflow.io` or `https://pact-broker.internal.example.com` |
| `PACT_BROKER_TOKEN` | secret | broker / PactFlow API token (optional for an unauthenticated self-hosted broker) |

## Standing up a broker

### Option A — PactFlow (hosted, free tier)

1. Create an account at <https://pactflow.io>.
2. Generate a read/write API token.
3. Set `PACT_BROKER_BASE_URL` and `PACT_BROKER_TOKEN` as above.

### Option B — self-hosted, alongside the monitoring stack

A `pact-broker` service (plus its own Postgres) is defined in the root
`docker-compose.yml` under the `pact-broker` profile, so it never starts with a
normal `docker compose up`:

```bash
docker compose --profile pact-broker up -d pact-broker
# UI + API on http://localhost:9292  (basic auth: pact / pact by default;
# override with PACT_BROKER_USERNAME / PACT_BROKER_PASSWORD)
```

For a real deployment run the same image behind TLS with a managed Postgres and a
strong credential pair, then point `PACT_BROKER_BASE_URL` at it.

## Local commands

```bash
# Publish a freshly generated consumer pact
PACT_BROKER_BASE_URL=http://localhost:9292 \
PACT_BROKER_TOKEN=... \
  bash scripts/pact-publish.sh SwiftRemitFrontend

# Ask whether the API at HEAD can go to an environment
PACT_BROKER_BASE_URL=http://localhost:9292 \
  bash scripts/pact-can-i-deploy.sh staging
```

## How the gate decides

`can-i-deploy --pacticipant SwiftRemitAPI --version <sha> --to-environment <env>`
passes only when, for every consumer recorded as present in `<env>`, there is a
**successful** verification of that consumer's pact against `SwiftRemitAPI`
version `<sha>`. The verification results come from the `provider-verification`
job in `pact-contract-tests.yml`, which runs on every push and publishes with
`publishVerificationResult` when a broker is configured.

Record consumer deployments/releases into the broker from each consumer's own
deploy pipeline (`pact-broker record-deployment --pacticipant SwiftRemitFrontend
--version <sha> --environment <env>`) so the gate has an accurate picture of what
is live.
