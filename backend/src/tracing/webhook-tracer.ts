/**
 * backend/src/tracing/webhook-tracer.ts — SR-108
 *
 * Wraps webhook delivery attempts in OpenTelemetry PRODUCER spans, injecting
 * trace context into outgoing request headers so the receiving end can
 * correlate its own traces back to the delivery.
 *
 * Usage:
 *   import { tracedWebhookDelivery } from './tracing/webhook-tracer';
 *
 *   await tracedWebhookDelivery(
 *     {
 *       eventType:     'remittance.completed',
 *       targetUrl:     'https://partner.example.com/webhooks',
 *       remittanceId:  '42',
 *       attemptNumber: 1,
 *     },
 *     (headers) => deliverToUrl(targetUrl, payload, headers)
 *   );
 */

import { trace, context, propagation, SpanKind, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('swiftremit-webhooks', '1.0.0');

export interface WebhookDeliverySpanOptions {
  eventType:     string;
  /** Full target URL — only the hostname is stored on the span */
  targetUrl:     string;
  remittanceId?: string;
  attemptNumber?: number;
}

/**
 * Wraps a single webhook delivery attempt in a PRODUCER span.
 * Calls fn() with a headers map that already contains the W3C traceparent header
 * so the downstream can link its processing trace back to this delivery.
 *
 * @param opts   Delivery metadata (used as span attributes)
 * @param fn     Delivery function; receives a Record<string,string> of headers to merge
 * @returns      The result of fn()
 */
export async function tracedWebhookDelivery<T>(
  opts: WebhookDeliverySpanOptions,
  fn: (injectableHeaders: Record<string, string>) => Promise<T>
): Promise<T> {
  // Store only the host to avoid leaking partner URLs in trace data
  const targetHost = (() => {
    try { return new URL(opts.targetUrl).host; }
    catch { return '[unknown-host]'; }
  })();

  return tracer.startActiveSpan(
    `webhook.deliver.${opts.eventType}`,
    {
      kind: SpanKind.PRODUCER,
      attributes: {
        'webhook.event_type':    opts.eventType,
        'webhook.target_url':    targetHost,
        'webhook.attempt_number': opts.attemptNumber ?? 1,
        'webhook.remittance_id': opts.remittanceId   ?? '',
      },
    },
    async (span) => {
      // Build the headers the caller should merge into the outgoing request
      const injectableHeaders: Record<string, string> = {};
      propagation.inject(context.active(), injectableHeaders);

      try {
        const result = await fn(injectableHeaders);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    }
  );
}
