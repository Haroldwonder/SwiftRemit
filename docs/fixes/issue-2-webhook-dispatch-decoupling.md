# Issue 2: Inbound anchor webhook blocked on outbound subscriber retries

## Problem

`WebhookDispatcher.attemptDelivery()` (`src/webhooks/dispatcher.ts`) retried failed
deliveries in-place with `await setTimeout(...)` followed by a recursive
`await this.attemptDelivery(...)`, up to `WEBHOOK_MAX_RETRIES` (default 5) attempts with
exponential backoff capped at `WEBHOOK_RETRY_MAX_MS` (default 300000ms). `dispatch()`
awaited this per-subscriber **sequentially** in a `for` loop.

`WebhookHandler.handleRemittanceCreated()` (`src/webhook-handler.ts`) called
`await this.dispatcher.dispatch(...)` inline, and `handleWebhook()` — the Express
handler mounted at `POST /webhooks/anchor` — awaited `handleRemittanceCreated()` before
sending its `200` response. If even one subscriber endpoint was down, the inbound anchor
webhook request could be held open for several minutes per subscriber (times however
many subscribers preceded the slow one, since dispatch was sequential), risking the
calling anchor's own delivery timeout/retry and duplicate anchor-side redelivery.

## Fix

1. **Parallel dispatch** (`dispatcher.ts` `dispatch()`): the subscriber loop now uses
   `Promise.allSettled` instead of a sequential `for...await` loop, so one slow
   subscriber no longer blocks delivery to the others.
2. **Wall-clock cap on inline retries** (`dispatcher.ts` `attemptDelivery()`): a new
   `WEBHOOK_INLINE_MAX_WALL_CLOCK_MS` env var (default 10000ms) bounds how long a single
   delivery is retried in-process. Once the next backoff delay would exceed that budget,
   the delivery is left `pending` in the store instead of retried inline — no more
   waiting out the full 5-attempt/300s-cap schedule inside the caller.
3. **Background completion**: a new `retryPendingWebhookDeliveries` cron job (every 2
   minutes, advisory-locked like the other jobs in `src/scheduler.ts`) calls the
   dispatcher's existing (previously unused-by-the-scheduler)
   `retryPendingDeliveries()` to finish any delivery deferred by the wall-clock cap.
4. **Decoupled inbound handler** (`webhook-handler.ts` `handleRemittanceCreated()`): the
   fan-out `dispatcher.dispatch('remittance.created', ...)` call is no longer awaited —
   it's fire-and-forget with a `.catch()` logger. The delivery is already durably
   recorded via `store.recordDelivery()` before any HTTP attempt, so nothing is lost;
   the inbound `/webhooks/anchor` handler now returns its `200` as soon as the DB insert
   completes instead of waiting on any subscriber's retry schedule.

## Files changed

- `backend/src/webhooks/dispatcher.ts`
- `backend/src/webhook-handler.ts`
- `backend/src/scheduler.ts`

## Not done (out of scope for a minimal fix)

Per the ticket's suggested approach, a fuller fix would move the entire retry loop out
of the inbound request path into a dedicated background worker (like
`WebhookDlqProcessor`) rather than capping inline retries. The wall-clock cap +
background completion job achieves the same bound on request latency with a much
smaller change.
