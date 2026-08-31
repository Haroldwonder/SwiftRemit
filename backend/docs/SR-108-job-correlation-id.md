# Job correlation ID propagation (SR-108 follow-up)

## Problem

`tracedJob()` in `src/tracing/job-tracer.ts` generated a per-run
`correlationId` and attached it only as an OpenTelemetry span attribute
(`correlation_id`). It never called `correlationStorage.run(correlationId,
fn)` from `src/correlation-id.ts`, so every job function passed to
`tracedJob` — `revalidate-stale-assets`, `poll-kyc-statuses`,
`poll-sep24-transactions`, `extend-contract-storage-ttl`,
`notify-kyc-expiries`, `check-anchor-health`, `retire-webhook-secrets` —
logged via `createLogger(...).info/warn/error`, which reads the
correlation ID from `correlationStorage`. Since that storage was never
populated for the job's execution, every structured log line emitted
during a scheduled job showed `correlationId: undefined`, while the span
for that same run carried a different, disconnected `correlation_id`
attribute. The two could never be cross-referenced.

Additionally, three AML jobs (`aml-periodic-rescreening`,
`aml-travel-rule-transmit`, `aml-data-retention`) were not wrapped in
`tracedJob` at all, so they had neither a span nor a correlation ID.

## What changed

- `tracedJob()` now runs the job body inside
  `correlationStorage.run(correlationId, () => fn())`, so every log line
  emitted anywhere inside the job (directly, or by any function it calls)
  picks up the same correlation ID that is on the span.
- `src/scheduler.ts`: the three AML jobs are now wrapped in `tracedJob`,
  matching every other scheduled job in the file.
- Added `src/__tests__/job-tracer-correlation-id.test.ts`, which mocks
  `@opentelemetry/api` to capture the span attributes passed to
  `startActiveSpan` and asserts:
  1. `getCorrelationId()` called from inside a `tracedJob`-wrapped
     function returns the same ID recorded on the span.
  2. A structured log line (`createLogger(...).info(...)`) emitted inside
     the job body has a `correlationId` field equal to the span's
     `correlation_id` attribute.

## Why this matters operationally

Before this change, an on-call engineer looking at a failed job's trace in
the OTel backend had no way to pull the matching application logs — the
`correlation_id` on the span didn't appear anywhere in the log stream.
After this change, filtering logs by the span's `correlation_id` attribute
returns exactly the log lines produced by that job run.
