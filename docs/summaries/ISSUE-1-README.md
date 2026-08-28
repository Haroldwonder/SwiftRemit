# Issue 1: Expo push tokens were never cleaned up on permanent delivery failure

## Problem

`DeviceTokenService.sendToUser()` in `backend/src/device-token-service.ts` sent
pushes via `sendExpoPush()`, which POSTs to the Expo Push API. When Expo
returned a ticket with `status: 'error'`, the only thing that happened was:

```ts
console.error('[push] Expo push error:', ticket.message);
```

Nothing inspected `ticket.details?.error`. Expo's documented client contract
is: when a ticket (or later, a delivery receipt) reports
`details.error === 'DeviceNotRegistered'`, the token is permanently dead
(app uninstalled, token rotated) and must be deleted so it stops being
retried.

On top of that, Expo's push flow is two-phase — a delivery *ticket* comes
back immediately, and the real delivery outcome (accepted, rejected, invalid
credentials, `DeviceNotRegistered`) only shows up later in a *receipt*
fetched from `/getReceipts`. The old code only ever looked at the ticket
phase, so real delivery failures that surface exclusively in the receipt
were never observed at all.

Net effect: `device_tokens` accumulated dead rows that were resubmitted to
Expo on every notification, for every affected user, forever — wasting Expo
API quota/batching capacity with no automatic cleanup.

## What was implemented

- `sendExpoPush()` now returns the raw ticket (and the token it belongs to)
  for every message sent, instead of just logging errors.
- `DeviceTokenService.processSendOutcomes()` inspects
  `ticket.details?.error`. If it's `DeviceNotRegistered`, the token is
  deleted immediately via `deregister()`.
- Successful tickets have their `ticket.id` persisted to a new
  `expo_push_tickets` table (token + user_id + created_at), so the delivery
  outcome can be resolved later.
- A new method, `pollReceiptsAndPruneStaleTokens()`, polls Expo's
  `/getReceipts` endpoint for previously-issued ticket IDs (that are at
  least a couple of minutes old, per Expo's own guidance on receipt
  availability) and deletes any token whose receipt reports
  `DeviceNotRegistered`. Tickets older than 24 hours (Expo's receipt
  retention window) are dropped without being re-checked, so the tracking
  table doesn't grow unbounded.
- A new scheduled job in `backend/src/scheduler.ts` runs
  `pollReceiptsAndPruneStaleTokens()` every 15 minutes under the existing
  advisory-lock pattern used by the other scheduler jobs, so only one
  instance runs it at a time in a multi-process deployment.

## Files touched

- `backend/src/device-token-service.ts`
- `backend/src/scheduler.ts`

## Result

Permanently-invalid tokens are now removed as soon as Expo reports them
(via the ticket, or within the following ~15 minutes via the receipt poll),
instead of being retried indefinitely.
