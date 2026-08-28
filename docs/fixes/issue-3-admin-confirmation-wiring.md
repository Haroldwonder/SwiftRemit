# Issue 3: AdminConfirmationService was never wired to any route

## Problem

`AdminConfirmationService` (`src/admin-confirmation.ts`) implements a two-step
confirmation flow (`initiate()` / `confirm()`) meant to require a second, different
admin to approve `withdraw_fees`, `remove_agent`, and `update_fee` before execution,
with a 1-hour expiry and audit logging via `AdminAuditLogService`. Grepping the
codebase showed it was referenced only inside its own file and test — no route in
`routes/admin.ts` or `api.ts` ever constructed or called it, and there was no route for
any of the three operations at all. The `pending_admin_actions` table and its audit
trail were never populated, and the safety control did not exist in practice.

An audit of the codebase found no other call site (contract call, admin script, or
otherwise) that actually performs `withdraw_fees`, `remove_agent`, or `update_fee`
today — these appear to be planned operations without an execution path yet.

## Fix

Rather than delete the module (the other option the ticket allowed), wired it to the
two endpoints the ticket's suggested approach names, in `src/routes/admin.ts`:

- `POST /api/admin/actions/:op/initiate` — validates `:op` is one of
  `withdraw_fees | remove_agent | update_fee`, requires `x-user-id` to identify the
  initiator, and calls `AdminConfirmationService.initiate()`.
- `POST /api/admin/actions/:id/confirm` — requires `x-user-id` to identify the
  confirmer (rejected if it matches the initiator, enforced inside the service), and
  calls `AdminConfirmationService.confirm()`. Maps `not found` → 404 and
  `expired`/`already confirmed`/self-confirmation → 409.
- `GET /api/admin/actions/pending` — lists outstanding unconfirmed, non-expired
  actions for operational visibility.

All three are gated by a new `requireAdminActionCredential()` check: an `x-admin-key`
header must match `process.env.ADMIN_ACTIONS_API_KEY`. If that env var isn't set, the
endpoints return `503` rather than being silently open — the generic `x-user-id` header
used elsewhere in this router is only an identity hint, not proof of admin
authorization, so it isn't sufficient on its own to gate a dual-control safety control.

Because no code path currently executes the underlying contract operations, `confirm()`
does not (and cannot yet) trigger execution — it authorizes an operator to carry out the
operation out of band using the returned `params`, with the `pending_admin_actions`
row and audit log as the system-of-record for that authorization. Wiring the eventual
execution call site to require a confirmed action ID is follow-up work once that call
site exists.

## Files changed

- `backend/src/routes/admin.ts`
