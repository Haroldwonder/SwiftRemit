import { getCorrelationId } from './correlation-id';
import { propagation, context } from '@opentelemetry/api';

/**
 * Custom fetch wrapper that propagates both the X-Correlation-ID header and
 * the W3C Trace Context (traceparent / tracestate) so that Stellar Horizon
 * HTTP calls are linked to the active distributed trace.
 */
export const correlationFetch: typeof fetch = (input, init) => {
  const headers = new Headers((init?.headers as RequestInit['headers']) ?? {});

  const cid = getCorrelationId();
  if (cid) {
    headers.set('X-Correlation-ID', cid);
  }

  // Inject W3C traceparent/tracestate into outbound Stellar Horizon requests
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  for (const [key, value] of Object.entries(carrier)) {
    headers.set(key, value);
  }

  return fetch(input, { ...init, headers });
};
