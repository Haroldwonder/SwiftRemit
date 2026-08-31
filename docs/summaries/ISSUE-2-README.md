# Issue 2: Inbound anchor webhook could be held open for minutes by a slow subscriber

## Problem

`WebhookDispatcher.attemptDelivery()` in `backend/src/webhooks/dispatcher.ts`
retried failed deliveries in-place: `await new Promise(resolve =>
setTimeout(resolve, delay))` followed by a recursive `await
this.attemptDelivery(...)`, up to `WEBHOOK_MAX_RETRIES` (default 5) attempts
with exponential backoff capped at `WEBHOOK_RETRY_MAX_MS` (default 300000ms
/ 5 minutes).

`dispatch()` awaited this **sequentially, per subscriber, inside a `for`
loop**. `WebhookHandler.handleRemittanceCreated()` in
`backend/src/webhook-handler.ts` called `await
this.dispatcher.dispatch('remittance.created', ...)` directly, and
`handleWebhook()` — the Express handler mounted at `POST /webhooks/anchor`
— awaited `handleRemittanceCreated()` before sending its own 200 response.

So if even one registered subscriber endpoint was down, the inbound anchor
webhook request could be held open for several minutes (5 retries × up to
300s backoff, multiplied by however many subscribers preceded the slow one)
before SwiftRemit's own webhook receiver ever responded — risking the
calling anchor's own delivery timeout/retry, connection-pool exhaustion
under load, and duplicate anchor-side webhook redelivery.

## What was implemented

- `dispatch()` in `backend/src/webhooks/dispatcher.ts` now fans out to all
  subscribers **concurrently** via `Promise.allSettled`, instead of
  awaiting them one at a time in a `for` loop.
- `attemptDelivery()` now tracks elapsed wall-clock time since the first
  attempt and enforces a new `WEBHOOK_INLINE_MAX_WALL_CLOCK_MS` budget
  (default 10 000 ms). If the next retry's delay would exceed that budget,
  the delivery is left in `'pending'` status instead of being retried
  in-process — it no longer blocks the caller.
- A new scheduler job (`retry-pending-webhook-deliveries`, every 2 minutes
  in `backend/src/scheduler.ts`) picks up deliveries left in `'pending'`
  by the wall-clock cutoff and finishes the retry sequence in the
  background, reusing the existing `getPendingDeliveries` /
  `retryPendingDeliveries` path.
- `WebhookHandler.handleRemittanceCreated()` no longer `await`s
  `dispatcher.dispatch(...)` inline. The dispatch call is now
  fire-and-forget (`.catch(...)` for logging only) — `store.recordDelivery`
  still durably records the delivery attempt before any HTTP call is made,
  so nothing is lost by not waiting on it, and `handleWebhook()` can send
  its 200 response immediately.

## Files touched

- `backend/src/webhooks/dispatcher.ts`
- `backend/src/webhook-handler.ts`
- `backend/src/scheduler.ts`

## Result

The inbound `POST /webhooks/anchor` handler responds as soon as the
delivery is durably recorded, instead of waiting on the full outbound
retry/backoff schedule for every subscriber. Slow or down subscribers now
only affect background retry jobs, not the anchor's inbound request.
