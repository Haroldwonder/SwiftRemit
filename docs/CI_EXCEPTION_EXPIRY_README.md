# Automated Vulnerability Exception Expiry — Implementation Notes

`docs/VULNERABILITY_EXCEPTIONS.md` states under "Audit & Review Cycle":

> **Automated Expiry Alerts**: Exceptions reaching their expiration date
> automatically fail CI builds until renewed or patched.

Nothing in the repository implemented that before this change: `.trivyignore`
and `deny.toml`'s `[advisories]` ignore list both use the required
`(Expires: YYYY-MM-DD)` comment convention, but no workflow parsed it, and
`container-security.yml`'s `trivy-scan` job never even passed `.trivyignore`
to Trivy. Both exception files are empty today, so the gap was latent — but
the first exception added under the documented policy would never have
expired in CI regardless of the date recorded in its comment.

## What was implemented

- **`scripts/check-exception-expiry.js`** — a small Node script with no
  external dependencies. It scans `.trivyignore` and `deny.toml` for the
  `Expires: YYYY-MM-DD` comment convention and exits non-zero if:
  - any entry's expiry date has passed, or
  - an `Expires:` comment is present but the date can't be parsed.
  It prints the offending file, line number, exception id (`CVE-...` /
  `RUSTSEC-...` when it can find one on the same line), and how many days
  overdue the entry is.

- **`.github/workflows/container-security.yml`**:
  - Added a `check-exception-expiry` job that runs the script, and made the
    existing `trivy-scan` job `needs:` it, so an expired `.trivyignore` entry
    blocks the image scan before it even starts.
  - Added `trivyignores: ".trivyignore"` to the Trivy scan step itself — it
    previously never referenced the file, so entries added to it had no
    effect on the scan one way or the other.

- **`.github/workflows/dependency-security.yml`**:
  - Added a step in `cargo-audit-and-deny` that runs the script ahead of the
    Rust dependency checks, so an expired `deny.toml` advisory exception
    blocks the build.
  - Added a `cargo deny --all-features check advisories` step. Previously
    the job title referenced "cargo deny" but only ran `cargo audit`; the
    `[advisories]` section in `deny.toml` was never actually evaluated by
    `cargo-deny` in CI.

## Not implemented / out of scope

- No test suite exercises `check-exception-expiry.js` directly — there is no
  existing test harness for the scripts under `scripts/` (e.g.
  `check-manifest-licenses.js` also has none), so this follows the existing
  convention rather than introducing a new one.
- The script does not validate the full exception format from
  `VULNERABILITY_EXCEPTIONS.md` (CVSS score, approver, justification) — only
  the `Expires:` date, which is the piece the policy says must gate CI.
