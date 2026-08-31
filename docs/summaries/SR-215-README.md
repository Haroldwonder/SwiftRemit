# SR-215: Add a retention/cleanup policy for per-commit GHCR image tags

**Reference:** Haroldwonder/SwiftRemit #1358 — Applied Aug 28, 2026

## Problem

`.github/workflows/deploy-staging.yml` pushes an immutable per-commit tag
`ghcr.io/<repo>/{backend,api,frontend}:<sha_short>` on every push to
`main`, in addition to the mutable `:staging` tag. No scheduled workflow
deleted old per-commit tags, so GHCR storage for the three image
repositories grew unbounded, with no way to distinguish "still referenced
by a running deployment" from "orphaned".

## What was implemented

- **New workflow `.github/workflows/ghcr-cleanup.yml`:**
  - Runs weekly (Monday 08:00 UTC — one hour after
    `container-security.yml`'s Monday scan) plus manual `workflow_dispatch`
    (which defaults to a dry run).
  - Matrix over `backend`, `api`, `frontend`; resolves the lowercased GHCR
    package path from `github.repository`.
  - Uses `snok/container-retention-policy@v3.1.0` with:
    - `cut-off: 30d` — delete versions older than 30 days;
    - `image-tags: "!staging !latest !main !v* !*.*.*"` — never delete the
      mutable staging tag, the rolling `latest`/`main` tags, or any
      semver / `v`-prefixed release tag;
    - `keep-n-most-recent: 10` — always retain the 10 newest versions per
      image as a manual-rollback floor;
    - `tag-selection: both` — also prunes dangling untagged manifests.
  - `v3.1.0` automatically protects multi-arch image children from
    deletion.
  - A preflight step fails fast with an explanatory error if the required
    `GHCR_RETENTION_TOKEN` secret is missing. The `!`/`*` filter operators
    the exclusions rely on are not available to the ephemeral
    `GITHUB_TOKEN`, so a classic PAT (`write:packages` + `delete:packages`)
    is required.
- **`docs/DEPLOYMENT.md`** gains a "GHCR Image Retention" section
  documenting the policy, the rollback window (~30 days or the last 10
  builds), the required secret, and the manual staging-VM rollback
  procedure — so on-call engineers know how far back they can roll an
  image tag.

## Files touched

- `.github/workflows/ghcr-cleanup.yml` (new)
- `docs/DEPLOYMENT.md`

## Result

Per-commit GHCR tags older than 30 days are pruned weekly across the three
image repos, while the staging tag, release tags, and the 10 most recent
builds per image are always preserved, and the retention window is
documented for on-call rollback.

## Suggested follow-up (not in scope)

- If the repo moves to an organization, change `account: user` to the org
  name in `ghcr-cleanup.yml`.
- Emit a summary of deleted tags to Slack after each weekly run.
