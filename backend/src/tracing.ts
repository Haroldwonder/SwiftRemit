/**
 * OpenTelemetry instrumentation for SwiftRemit backend. — SR-108
 *
 * Import this module FIRST (before any other imports) in index.ts so that
 * auto-instrumentation patches are applied before the libraries are loaded.
 *
 * Environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  – OTLP HTTP endpoint (default: http://localhost:4318)
 *   OTEL_SERVICE_NAME            – Service name reported in traces (default: swiftremit-backend)
 *   OTEL_ENABLED                 – Set to "false" to disable tracing (default: true)
 *   OTEL_TRACES_SAMPLER          – Sampler type (default: parentbased_traceidratio)
 *                                  Valid: always_on, always_off, traceidratio, parentbased_traceidratio
 *   OTEL_TRACES_SAMPLER_ARG      – Sampler argument (default: 0.1 in production, 1.0 in dev)
 *   JAEGER_ENDPOINT              – Jaeger OTLP endpoint (overrides OTEL_EXPORTER_OTLP_ENDPOINT)
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import {
  AlwaysOnSampler,
  AlwaysOffSampler,
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { trace, context, propagation, SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { getCorrelationId } from './correlation-id';

const enabled = process.env.OTEL_ENABLED !== 'false';

/**
 * Build the configured sampler.
 * Defaults: 10% sampling in production, 100% in development.
 *
 * OTEL_TRACES_SAMPLER values:
 *   always_on                 – sample everything
 *   always_off                – sample nothing
 *   traceidratio              – sample a fixed fraction (arg: 0.0–1.0)
 *   parentbased_traceidratio  – respect parent decision; apply ratio to new roots
 */
function buildSampler() {
  const samplerType = process.env.OTEL_TRACES_SAMPLER ?? 'parentbased_traceidratio';
  const isDev = (process.env.NODE_ENV ?? 'production') === 'development';
  const defaultRatio = isDev ? 1.0 : 0.1;
  const ratio = parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG ?? String(defaultRatio));

  switch (samplerType) {
    case 'always_on':
      return new AlwaysOnSampler();
    case 'always_off':
      return new AlwaysOffSampler();
    case 'traceidratio':
      return new TraceIdRatioBasedSampler(ratio);
    case 'parentbased_traceidratio':
    default:
      return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) });
  }
}

let sdk: NodeSDK | null = null;

if (enabled) {
  const endpoint = process.env.JAEGER_ENDPOINT
    ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ?? 'http://localhost:4318';

  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]:    process.env.OTEL_SERVICE_NAME ?? 'swiftremit-backend',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '1.0.0',
    }),
    traceExporter: exporter,
    sampler: buildSampler(),
    instrumentations: [
      new HttpInstrumentation({
        // Extract incoming traceparent headers and propagate to outbound calls
        headersToSpanAttributes: {
          client: { requestHeaders: ['x-correlation-id', 'traceparent'] },
          server: { requestHeaders: ['x-correlation-id', 'traceparent'] },
        },
        // Write X-Trace-Id on responses so callers can log it
        responseHook: (span, response) => {
          const traceId = span.spanContext().traceId;
          if (traceId && (response as any).setHeader) {
            (response as any).setHeader('x-trace-id', traceId);
          }
        },
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  });

  sdk.start();
  console.log(
    `[otel] Backend tracing started — endpoint=${endpoint} sampler=${process.env.OTEL_TRACES_SAMPLER ?? 'parentbased_traceidratio'}`
  );

  process.on('SIGTERM', () => sdk!.shutdown().catch(console.error));
  process.on('SIGINT',  () => sdk!.shutdown().catch(console.error));
}

/** Returns the active tracer for manual span creation. */
export function getTracer(name = 'swiftremit') {
  return trace.getTracer(name);
}

/**
 * Wrap an async operation in a named span.
 * Automatically records exceptions and sets error status.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const tracer = getTracer();
  const span = tracer.startSpan(name);
  span.setAttribute('correlation_id', getCorrelationId() ?? '');
  if (attributes) span.setAttributes(attributes);

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn(span);
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

export { trace, context, propagation };
