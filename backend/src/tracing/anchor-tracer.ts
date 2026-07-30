/**
 * backend/src/tracing/anchor-tracer.ts — SR-108
 *
 * Wraps outbound anchor HTTP calls in OpenTelemetry CLIENT spans and injects
 * W3C trace context (traceparent / tracestate) into outgoing request headers.
 *
 * Usage:
 *   import { anchoredFetch } from './tracing/anchor-tracer';
 *
 *   const resp = await anchoredFetch(
 *     'https://anchor.example.com/sep24/transactions',
 *     { method: 'GET', headers: { Authorization: 'Bearer ...' } },
 *     'sep24.transactions.list',
 *     { sepOperation: 'sep24.list', anchorId: 'moneygram' }
 *   );
 */

import { trace, context, propagation, SpanKind, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('swiftremit-anchor', '1.0.0');

export interface AnchorFetchOptions extends RequestInit {
  headers?: Record<string, string>;
}

export interface AnchorSpanAttributes {
  /** SEP operation name (e.g. 'sep24.deposit', 'sep24.list', 'sep12.kyc') */
  sepOperation?: string;
  /** Anchor ID (e.g. 'moneygram') */
  anchorId?: string;
}

/**
 * Wraps a fetch call to an anchor endpoint in an OpenTelemetry CLIENT span.
 * Injects W3C traceparent / tracestate headers into the outgoing request so
 * anchor-side traces can be correlated.
 *
 * Auth tokens and sensitive query params are stripped from the span's http.url
 * attribute to prevent leaking secrets.
 */
export async function anchoredFetch(
  url: string,
  options: AnchorFetchOptions = {},
  spanName: string,
  attrs: AnchorSpanAttributes = {}
): Promise<Response> {
  const sanitisedUrl = sanitiseUrl(url);

  return tracer.startActiveSpan(
    `anchor.${spanName}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'http.method':   (options.method ?? 'GET').toUpperCase(),
        'http.url':      sanitisedUrl,
        'sep.operation': attrs.sepOperation ?? '',
        'anchor.id':     attrs.anchorId     ?? '',
      },
    },
    async (span) => {
      // Inject W3C trace context into outgoing headers
      const headers: Record<string, string> = { ...(options.headers ?? {}) };
      propagation.inject(context.active(), headers);

      try {
        const response = await fetch(url, { ...options, headers });
        span.setAttribute('http.status_code', response.status);

        if (!response.ok) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }

        return response;
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

/** Strip auth-bearing query params so secrets don't appear in trace data. */
function sanitiseUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const sensitiveParams = ['token', 'api_key', 'apikey', 'key', 'secret', 'access_token', 'auth'];
    for (const param of sensitiveParams) {
      if (u.searchParams.has(param)) u.searchParams.set(param, '[REDACTED]');
    }
    return u.toString();
  } catch {
    return '[invalid-url]';
  }
}
