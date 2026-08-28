# Issue 3: AdminConfirmationService existed but was wired to nothing

## Problem

`AdminConfirmationService` in `backend/src/admin-confirmation.ts` implements
a two-step confirmation flow (`initiate()` / `confirm()`) meant to require a
second, different admin to approve high-risk operations (`withdraw_fees`,
`remove_agent`, `update_fee`) before they execute, with a 1-hour expiry and
full audit logging via `AdminAuditLogService`.

Grepping the codebase for `AdminConfirmationService` showed it was
referenced only inside its own file and its dedicated test —
`backend/src/routes/admin.ts` and `backend/src/api.ts` never constructed or
called it, and there was no route corresponding to `withdraw_fees`,
`remove_agent`, or `update_fee` at all. The `pending_admin_actions` table
and its audit trail were never populated in practice, so the dual-admin
safety control provided no actual protection.

## What was implemented

`backend/src/routes/admin.ts` now constructs an `AdminConfirmationService`
and exposes three endpoints:

- `POST /api/admin/actions/:op/initiate` — starts a pending action for one
  of `withdraw_fees`, `remove_agent`, `update_fee`. Requires the
  initiating admin's identity via `x-user-id` and returns the pending
  action's id, operation, initiator, and expiry.
- `POST /api/admin/actions/:id/confirm` — confirms a pending action.
  `AdminConfirmationService.confirm()` already enforces that the confirming
  admin differs from the initiator, that the action hasn't expired, and
  that it hasn't already been confirmed; this route maps those failure
  modes to `404` (not found) / `409` (expired, already confirmed, or
  self-confirmation) / `500` (unexpected).
- `GET /api/admin/actions/pending` — lists all pending, non-expired
  actions for operator visibility.

All three endpoints are gated by `requireAdminActionCredential()`, which
checks a dedicated `x-admin-key` header against `ADMIN_ACTIONS_API_KEY` —
deliberately separate from the identity-only `x-user-id` header used
elsewhere in the router, since that header is not proof of admin
authorization. If `ADMIN_ACTIONS_API_KEY` isn't configured, the endpoints
respond `503` instead of silently allowing unauthenticated access.

Because no other part of the codebase currently makes a real
`withdraw_fees` / `remove_agent` / `update_fee` call against the contract
or an admin script, this router does not itself execute those operations —
confirming an action here authorizes an operator to carry it out out of
band using the returned params. The `pending_admin_actions` row and the
`AdminAuditLogService` entries (`{operation}.initiated` /
`{operation}.confirmed`) are the system-of-record for that authorization.

## Files touched

- `backend/src/routes/admin.ts`

## Result

`AdminConfirmationService` is now reachable via real, credential-gated
routes, so the dual-admin control it implements is actually enforced and
its audit trail is populated, instead of being dead code.
