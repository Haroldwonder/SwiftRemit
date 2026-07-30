# Distributed Tracing — SR-108

SwiftRemit uses OpenTelemetry to trace the full remittance path from the browser
through the API, backend, Soroban RPC calls, anchor HTTP calls, and webhook
deliveries into a single correlated trace.

---

## Architecture

```
Browser / Mobile
  │  (injects traceparent header via injectTraceContext())
  ▼
API Service  ──────────────────────────────────── (api/src/tracing.ts)
  │  HTTP spans (auto: @opentelemetry/instrumentation-http)
  │  Express spans (auto: @opentelemetry/instrumentation-express)
  │  Responds with X-Trace-Id header
  ▼
Backend Service ────────────────────────────────── (backend/src/tracing.ts)
  │  HTTP spans, Express spans, PG spans (auto)
  │
  ├── Scheduled Jobs ──────────────────────────── (tracing/job-tracer.ts)
  │     root span: job.<name>  [correlation_id attribute]
  │
  ├── Soroban RPC ──────────────────────────────── (tracing/soroban-tracer.ts)
  │     CLIENT span: soroban.<method>
  │     attributes: contract.function, ledger.sequence, soroban.resource_fee
  │
  ├── Anchor HTTP calls ───────────────────────── (tracing/anchor-tracer.ts)
  │     CLIENT span: anchor.<operation>
  │     injects traceparent into outgoing headers
  │     attributes: sep.operation, anchor.id, http.url (sanitised)
  │
  └── Webhook deliveries ──────────────────────── (tracing/webhook-tracer.ts)
        PRODUCER span: webhook.deliver.<event_type>
        injects traceparent into outgoing request headers
        attributes: webhook.event_type, webhook.target_url (host only),
                    webhook.attempt_number, webhook.remittance_id

All spans exported to Jaeger via OTLP HTTP on port 4318.
Jaeger UI available at http://localhost:16686.
```

---

## Running Jaeger locally

```bash
# Start the full stack (includes Jaeger)
docker compose up -d jaeger

# Or start everything
docker compose up -d

# Open the Jaeger UI
open http://localhost:16686
```

Jaeger is pre-configured in `docker-compose.yml`:
- UI:        http://localhost:16686
- OTLP gRPC: localhost:4317
- OTLP HTTP: localhost:4318

---

## Finding a full remittance trace

1. Open Jaeger UI at http://localhost:16686
2. Select service: `swiftremit-api` or `swiftremit-backend`
3. Search for traces tagged with `webhook.event_type = remittance.completed`
4. Click any trace — it should show spans across:
   - API HTTP handler
   - Backend processing
   - `soroban.simulateTransaction` / `soroban.sendTransaction`
   - `anchor.<operation>` (if an anchor was involved)
   - `webhook.deliver.remittance.completed`

### Verifying the full trace spans all hops

A complete create→complete remittance trace should contain at least these span types:

| Span name pattern | Source | Kind |
|------------------|--------|------|
| `POST /api/remittances` | API | SERVER |
| `POST /api/remittance` (backend) | API→Backend | CLIENT |
| `soroban.simulateTransaction` | Backend | CLIENT |
| `soroban.sendTransaction` | Backend | CLIENT |
| `job.poll-sep24-transactions` | Backend (scheduler) | INTERNAL |
| `anchor.sep24.pollTransactions` | Backend | CLIENT |
| `webhook.deliver.remittance.completed` | Backend | PRODUCER |

If any hop is missing, check the corresponding tracer file and confirm the import
is in place.

---

## Sampling configuration

Sampling is controlled by two environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_TRACES_SAMPLER` | `parentbased_traceidratio` | Sampler type |
| `OTEL_TRACES_SAMPLER_ARG` | `0.1` (prod) / `1.0` (dev) | Ratio for traceidratio samplers |

### Valid sampler values

| Value | Behaviour |
|-------|-----------|
| `always_on` | Sample every request (use in dev/debug only) |
| `always_off` | Sample nothing (disables tracing) |
| `traceidratio` | Sample a fixed fraction of new root spans |
| `parentbased_traceidratio` | Respect parent's sampling decision; apply ratio to new roots |

### Recommended settings

```bash
# Development: sample everything
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=1.0

# Staging: sample 50%
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.5

# Production: sample 10%
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

---

## Frontend / mobile trace context propagation

The API automatically echoes the current trace ID as `X-Trace-Id` on every response.
Frontend code should propagate `traceparent` on outgoing API requests:

```typescript
// frontend/src/utils/tracing.ts (example pattern)
export function injectTraceContext(headers: Record<string, string>): Record<string, string> {
  // The backend sets a <meta name="trace-parent"> tag or a window variable
  const traceparent = (window as any).__TRACE_PARENT__;
  if (traceparent) {
    return { ...headers, traceparent };
  }
  return headers;
}

// Usage in your API client:
const response = await fetch('/api/remittances', {
  headers: injectTraceContext({ 'Content-Type': 'application/json' }),
});

// Log the trace ID from the response for support lookups
const traceId = response.headers.get('x-trace-id');
console.debug('[trace]', traceId);
```

Mobile (React Native / Expo): use the same pattern with `@opentelemetry/api` and
set `traceparent` on every `fetch` call. The `@swiftremit/sdk` react-native package
can be extended to inject headers automatically.

---

## Adding a new instrumented boundary

1. Create (or reuse) a tracer file in `backend/src/tracing/` or `api/src/tracing/`.
2. Use `tracedSorobanCall`, `anchoredFetch`, `tracedJob`, or `tracedWebhookDelivery`
   as appropriate.
3. For a new boundary type, use `tracer.startActiveSpan()` with the correct `SpanKind`.

**Template for a new CLIENT span:**

```typescript
import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('swiftremit-myservice');

export async function tracedMyCall<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(`myservice.${name}`, { kind: SpanKind.CLIENT }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

4. Add the call site, then verify the span appears in Jaeger under the expected service.
5. Update the architecture diagram in this document.
