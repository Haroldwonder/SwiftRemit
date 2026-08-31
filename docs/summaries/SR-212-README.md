# SR-212: Make mobile EAS builds verify the native build actually succeeded

**Reference:** Haroldwonder/SwiftRemit #1355 — Applied Aug 28, 2026

## Problem

In `.github/workflows/mobile-ci.yml`, both `eas-build-ios` and
`eas-build-android` submitted builds with:

```
eas build --platform ... --no-wait --json > /tmp/eas-*-build.json || true
```

and then just `cat`-ed the JSON. The block that would wait for the build,
check its result, and download the artifact was present but commented out.
Combined with `|| true` swallowing any submission failure, CI reported
these jobs as passed regardless of whether the native iOS/Android build
config was broken. A regression in native build config would only surface
when someone manually checked the Expo dashboard, defeating the purpose of
having the jobs in CI.

## What was implemented

- **Removed `|| true`** from both submission steps and added
  `set -euo pipefail`, so a failed `eas build` submission fails the job
  immediately.
- **Conditional wait by trigger:**
  - On `push` (merge to `main`): `eas build --wait --json`. With `--wait`
    the CLI calls `exitWithNonZeroCodeIfSomeBuildsFailed`, so an `ERRORED`
    or `CANCELED` native build fails the job. A defensive check on the
    reported `status` (`FINISHED` only) backs this up.
  - On pull requests (with the `build` label): keeps `--no-wait` for fast
    PR feedback.
- **Artifact download re-enabled** for `push` runs: `eas build:download
  --id <id> --non-interactive --json`, then `actions/upload-artifact`
  uploads the archive path the CLI reports (`.path`). The old commented
  code used a non-existent `--output` flag; current `eas-cli` downloads to
  a cache dir and prints the path in `--json` mode.
- **New scheduled `eas-build-health` job** (daily at 06:00 UTC, plus
  `workflow_dispatch`): runs `eas build:list --platform <p> --limit 5
  --json` for iOS and Android, finds the most recent build in a terminal
  state, and fails if it is not `FINISHED`. This is the safety net for the
  `--no-wait` PR path — a native build-config regression that lands via a
  PR is caught within a day instead of never.
- `schedule` and `workflow_dispatch` triggers added to the workflow; the
  `concurrency` group routes scheduled runs to their own group so a PR run
  never cancels the health check.

## Files touched

- `.github/workflows/mobile-ci.yml`

## Result

A broken native iOS/Android build config now fails `Mobile CI` on merge to
`main` (blocking, via `--wait`), and any regression that slips through a
`--no-wait` PR build is caught by the daily `eas-build-health` job instead
of silently sitting green until someone opens the Expo dashboard.

## Suggested follow-up (not in scope)

- Route `eas-build-health` failures to Slack/PagerDuty rather than relying
  on the default workflow-failure email.
- Consider caching `node_modules` in the health job if `eas build:list`
  ever needs project dependencies to resolve the Expo project.
