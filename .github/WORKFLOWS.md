# GitHub Actions Workflows - Consolidated Structure

## Overview
This project uses a consolidated CI/CD workflow structure that eliminates duplication and centralizes configuration. Workflows are organized by:
- **Primary purpose** (CI, testing, deployment)
- **Path filtering** (files touched trigger specific jobs)
- **Concurrency groups** (prevent workflow spam on force-pushes)

## Toolchain Versions
Standard toolchain versions used across workflows:
- Node.js: 20
- Rust: stable
- PostgreSQL: 15-alpine (CI), 16-alpine (local docker-compose)
- Helm: 3.17.0

When updating versions, search for version strings across `.github/workflows/` and update all references consistently.

## Composite Actions
Shared setup logic is extracted to `.github/actions/`:

### setup-rust
Configures Rust toolchain with cargo caching.
```yaml
- uses: ./.github/actions/setup-rust
  with:
    components: rustfmt,clippy
    targets: wasm32-unknown-unknown
```

### setup-node
Configures Node.js with npm caching and `npm ci`.

This repo is a single npm-workspaces project with **one** lockfile at the repo
root, so `npm ci` always runs at the root and installs every workspace. The
`working-directory` input is deprecated and ignored.
```yaml
- uses: ./.github/actions/setup-node
  with:
    cache-dependency-path: package-lock.json
```

### setup-db
Starts PostgreSQL and runs migrations.
```yaml
- uses: ./.github/actions/setup-db
```

## Primary Workflows

### ci-consolidated.yml
**Trigger:** PR to main/develop, push to main
**Purpose:** Full CI suite with path-filtered jobs
**Jobs:** Rust (fmt, clippy, test), Backend (typecheck, lint, test), API (typecheck, lint, test), Frontend (typecheck, lint, coverage), SDK (bundle size), Helm (chart lint)
**Key features:**
- Runs only jobs relevant to changed paths
- Enforces 95% frontend coverage gate
- Warns on SDK bundle size > 100 KB gzipped
- Collects coverage reports to Codecov

### contract-ci-consolidated.yml
**Trigger:** Push/PR affecting src/, Cargo.*, rust-toolchain.toml
**Purpose:** Smart contract validation
**Jobs:** cargo fmt, cargo clippy, cargo test (with legacy-tests feature), cargo build (wasm32), README function coverage
**Key features:**
- Uses setup-rust action (consolidates cache logic)
- Uploads WASM artifact for 7 days
- Reports WASM binary size

### backend-ci-consolidated.yml
**Trigger:** PR/push affecting backend/
**Purpose:** Backend service-specific testing (optional parallel to ci-consolidated)
**Jobs:** lint, test & coverage
**Key features:**
- Mirrors jobs from ci-consolidated.yml
- Can run in parallel (same code checked twice, faster feedback)
- Ideal for backend-only PRs

**Consolidation completed:** 2026-08-28
- Removed legacy ci.yml, backend-ci.yml, and contract-ci.yml
- All CI now runs through consolidated workflows only
- Branch protection rules updated to reference consolidated job names

## Independent Workflows
These run on dedicated schedules and are NOT consolidated:

- **dependency-security.yml** — Consolidated dependency & security audit (npm audit + cargo audit), runs on push/PR to main and weekly on Monday at 6 AM UTC
- **container-security.yml** — Container image scans (on release)
- **ghcr-cleanup.yml** — Prune old per-commit GHCR image tags (weekly, SR-215)
- **deploy-staging.yml** — Deploy to staging (manual trigger)
- **deploy-mainnet.yml** — Deploy to mainnet (manual trigger)
- **release.yml** — Version bumps & releases (manual trigger)
- **publish-abi.yml** — Publish contract ABI (on contract changes)

## Concurrency & Cancellation

All consolidatedworkflows use:
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

This ensures:
- Only one run per workflow per branch
- Force-pushes cancel in-flight runs
- Reduces CI queue time and resource waste

## Path Filtering

Jobs use GitHub's native path filtering combined with dorny/paths-filter for efficient change detection:

```yaml
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      backend: ${{ steps.filter.outputs.backend }}
    steps:
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            backend:
              - 'backend/**'

  backend-test:
    needs: changes
    if: github.event_name == 'push' || needs.changes.outputs.backend == 'true'
```

This means:
- All jobs run on push to main (full suite)
- PR jobs run only if those paths changed
- Path changes are detected once and reused across all jobs

## Adding New Jobs

1. **Add to existing workflow** if it matches an existing category (Rust, Node, etc.)
2. **Use composite actions** for any setup (setup-rust, setup-node, setup-db)
3. **Add path filtering** in the changes job and reference the output in your job's `if:` condition
4. **Update this document** with the new job's purpose
5. **Set concurrency group** if multiple runs could interfere

Example:
```yaml
jobs:
  changes:
    outputs:
      mobile: ${{ steps.filter.outputs.mobile }}
    steps:
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            mobile:
              - 'mobile/**'

  mobile-test:
    name: Mobile tests
    runs-on: ubuntu-latest
    needs: changes
    if: github.event_name == 'push' || needs.changes.outputs.mobile == 'true'
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node
        with:
          cache-dependency-path: package-lock.json
      - run: npm test
        working-directory: mobile
```

## Migrating Old Workflows

To migrate a legacy workflow to the consolidated structure:

1. Copy relevant jobs to `ci-consolidated.yml`
2. Add path filtering based on job's purpose
3. Replace inline setup with composite actions
4. Add concurrency group (if not already present)
5. Test on a PR
6. Delete old workflow file

Example (before consolidation):
```yaml
# old-ci.yml
- uses: actions/checkout@v4
- uses: dtolnay/rust-toolchain@stable
- uses: actions/cache@v4
  with:
    path: ...
    key: ...
- run: cargo build
```

Example (after consolidation):
```yaml
# ci-consolidated.yml
- uses: actions/checkout@v4
- uses: ./.github/actions/setup-rust
- run: cargo build
```

## Troubleshooting

**Jobs not running?** Check:
1. Is the workflow file enabled in `.github/workflows/`?
2. Does the path filter match changed files?
3. Is concurrency set to `cancel-in-progress: true`? (May cancel if force-pushed)

**Composite action failing?** Ensure:
1. Action .yml is in `.github/actions/<name>/action.yml`
2. Action uses `shell: bash` (not `run:` outside composite)
3. Inputs/outputs are correctly defined

**Version sync issues?** 
1. Search for the version string across `.github/workflows/*.yml`
2. Update all occurrences consistently
3. Avoid hardcoding versions in jobs when possible (use composite actions)

## Metrics & Monitoring

To monitor workflow efficiency:
1. GitHub Actions tab shows run times and cancellations
2. Logs include concurrency cancellations
3. Artifact storage usage per workflow

Optimize by:
- Reducing number of concurrent matrix jobs
- Removing unused path filters (jobs that always run)
- Batching slow jobs (e.g., SDK bundle size can be lint-only)
