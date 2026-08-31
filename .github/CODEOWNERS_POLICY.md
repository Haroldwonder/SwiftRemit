# CODEOWNERS & review-routing policy (SR-213)

This repo has domain-separated areas (smart contract, backend services, frontend
& mobile, infrastructure/CI). Historically every path in
[`CODEOWNERS`](CODEOWNERS) resolved to a single handle, which gave any
CODEOWNERS-gated branch-protection rule an effective bus factor of one and made
it impossible to route contract review, infra review, and frontend review to
different people.

`CODEOWNERS` now routes each domain to a GitHub team. This document is the
source of truth for what those teams are and how branch protection is expected
to be configured.

## Teams

Create these teams under the `Haroldwonder` org (Organization → Teams → New
team). They may start with the same members they have today — the point is that
the structure exists before more contributors join, so onboarding a domain
reviewer is a team-membership change and never a `CODEOWNERS` edit.

| Team | Handle | Owns |
|------|--------|------|
| Maintainers | `@Haroldwonder/maintainers` | Fallback for unmatched paths, `docs/`, root governance docs, `CODEOWNERS` itself |
| Contract team | `@Haroldwonder/contract-team` | `src/`, `tests/`, `fuzz/`, `benches/`, `Cargo.*`, `rust-toolchain.toml` |
| Backend team | `@Haroldwonder/backend-team` | `api/`, `backend/`, `sdk/` |
| Frontend team | `@Haroldwonder/frontend-team` | `frontend/`, `mobile/` |
| Infra team | `@Haroldwonder/infra-team` | `charts/`, `monitoring/`, `scripts/`, `.github/` (incl. `.github/workflows/`), `docker-compose*.yml` |

Each team needs **Write** access to the repository for its `CODEOWNERS` entries
to be honoured (Settings → Collaborators and teams). A team with no members
does not block merges — GitHub falls through to the next matching rule and
ultimately to the `*` fallback, which also lists `@Haroldwonder` directly.

## Branch protection for `main`

Configure under Settings → Branches → Branch protection rules for `main`:

- **Require a pull request before merging** — on.
- **Require review from Code Owners** — on. This makes the table above load-bearing.
- **Required approvals: 2.** With single-domain ownership a lone code owner
  could approve their own area's change after a trivial second pass; a second
  required reviewer means no single CODEOWNERS match can carry a merge on its
  own.
- **Dismiss stale approvals when new commits are pushed** — on.
- **Do not allow bypassing the above settings** — on (admins included).

## Keeping this in sync

When you add, remove, or re-scope a path in [`CODEOWNERS`](CODEOWNERS), update
the table above in the same PR. The `docs/`-owning maintainers team is the
reviewer for both files, so the change is caught in review.
