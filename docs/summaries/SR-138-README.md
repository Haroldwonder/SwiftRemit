# SR-138: Prune dead Expo push tokens on permanent delivery failure

**Reference:** Haroldwonder/SwiftRemit #1281 — Applied Aug 27, 2026, 11:42 PM

## Problem

`DeviceTokenService.sendToUser()` in `backend/src/device-token-service.ts`
sent pushes via `sendExpoPush()`, which POSTs to the Expo Push API. When
Expo returned a ticket with `status: 'error'`, the code only logged
`ticket.message` — it never inspected `ticket.details?.error`. Expo's
documented client contract is: when a ticket (or a later delivery receipt)
reports `details.error === 'DeviceNotRegistered'`, the token is
permanently dead (app uninstalled, token rotated) and must be deleted so
it stops being retried.

Expo's push flow is also two-phase — a delivery *ticket* is returned
immediately, and the real delivery outcome (accepted, rejected, invalid
credentials, `DeviceNotRegistered`) only surfaces later in a *receipt*
fetched from `/getReceipts`. Only handling the ticket phase meant real
delivery failures visible solely in the receipt were never observed.

Net effect: `device_tokens` accumulated dead rows that were resubmitted to
Expo on every notification, for every affected user, indefinitely —
wasting Expo API quota/batching capacity with no automatic cleanup.

## What was implemented

- `sendExpoPush()` returns the raw ticket (and its source token) for every
  message sent.
- `DeviceTokenService.processSendOutcomes()` checks
  `ticket.details?.error`; on `DeviceNotRegistered` it calls
  `deregister()` to delete that token immediately.
- Successful tickets have their `ticket.id` persisted to a new
  `expo_push_tickets` table (token + user_id + created_at) for later
  receipt resolution.
- `pollReceiptsAndPruneStaleTokens()` polls Expo's `/getReceipts` endpoint
  for previously-issued ticket IDs and deletes any token whose receipt
  reports `DeviceNotRegistered`. Tickets older than 24 hours (Expo's
  receipt retention window) are dropped without re-checking.
- A new scheduler job in `backend/src/scheduler.ts` runs
  `pollReceiptsAndPruneStaleTokens()` every 15 minutes under the existing
  advisory-lock pattern, so only one instance runs it at a time.

## Files touched

- `backend/src/device-token-service.ts`
- `backend/src/scheduler.ts`

## Result

Permanently-invalid tokens are now removed as soon as Expo reports them —
either via the immediate ticket or within ~15 minutes via the receipt
poll — instead of being retried indefinitely.
