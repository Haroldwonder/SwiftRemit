/**
 * OpenTelemetry instrumentation for SwiftRemit backend.
 *
 * Import this module FIRST (before any other imports) in index.ts so that
 * auto-instrumentation patches are applied before the libraries are loaded.
 *
 * Environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  – OTLP HTTP endpoint (default: http://localhost:4318)
 *   OTEL_SERVICE_NAME            – Service name reported in traces (default: swiftremit-backend)
 *   OTEL_ENABLED                 – Set to "false" to disable tracing (default: true)
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { trace, context, propagation, SpanStatusCode, Span } from '@opentelemetry/api';

const enabled = process.env.OTEL_ENABLED !== 'false';

let sdk: NodeSDK | null = null;

if (enabled) {
  const exporter = new OTLPTraceExporter({
    url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'}/v1/traces`,
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'swiftremit-backend',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '1.0.0',
    }),
    traceExporter: exporter,
    instrumentations: [
      new HttpInstrumentation({
        // Propagate W3C trace context to outbound anchor API calls
        headersToSpanAttributes: {
          client: { requestHeaders: ['x-correlation-id'] },
        },
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  });

  sdk.start();
  console.log('[otel] Tracing started — exporting to', process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318');

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
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      span.setAttributes(attributes);
    }
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
