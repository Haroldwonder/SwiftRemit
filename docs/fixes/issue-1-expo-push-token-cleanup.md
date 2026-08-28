# Issue 1: Dead Expo push tokens never get cleaned up

## Problem

`DeviceTokenService.sendToUser()` (`src/device-token-service.ts`) sent messages via
`sendExpoPush()`, which only logged `ticket.status === 'error'` and never inspected
`ticket.details?.error`. Expo's documented client contract is: when a ticket (or later,
a delivery receipt) reports `DeviceNotRegistered`, the token is permanently dead (app
uninstalled / token rotated) and must be deleted so it stops being retried.

In addition, Expo push delivery is two-phase — a ticket is returned immediately from
`/push/send`, but the actual delivery outcome (rejected, error, bad credentials) is only
available later from `/push/getReceipts`. This module only ever handled the ticket
phase, so real delivery failures were invisible, and `device_tokens` accumulated dead
rows resent to Expo forever.

## Fix

- `sendExpoPush()` now returns the full ticket (including `details.error`) paired with
  the source token instead of swallowing it after logging.
- `DeviceTokenService.sendToUser()` inspects each outcome:
  - `DeviceNotRegistered` on the immediate ticket → deletes the token immediately via
    `this.deregister()`.
  - A successful ticket (`status: 'ok'`, has `id`) → persists `{ticket_id, token,
    user_id}` to a new `expo_push_tickets` table (auto-created on first use, mirroring
    the `initTable()` pattern already used by `AdminConfirmationService`) so the receipt
    phase can be resolved later.
- New `DeviceTokenService.pollReceiptsAndPruneStaleTokens()`:
  - Fetches tickets aged 2 minutes–24 hours old, calls Expo's `/getReceipts` in batches
    of up to 1000 IDs.
  - Deregisters tokens whose receipt reports `DeviceNotRegistered`.
  - Deletes resolved ticket rows (and unconditionally drops tickets older than 24h,
    since Expo no longer serves receipts for them) so the table doesn't grow unbounded.
- `src/scheduler.ts`: added a new cron job (`*/15 * * * *`, advisory-locked like every
  other job in the file) that calls the new method, plus the `DeviceTokenService`
  instance wiring.

## Files changed

- `backend/src/device-token-service.ts`
- `backend/src/scheduler.ts`
