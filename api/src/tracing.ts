/**
 * OpenTelemetry instrumentation for SwiftRemit API service.
 *
 * Import this module FIRST (before any other imports) in index.ts so that
 * auto-instrumentation patches are applied before the libraries are loaded.
 *
 * Environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  – OTLP HTTP endpoint (default: http://localhost:4318)
 *   OTEL_SERVICE_NAME            – Service name reported in traces (default: swiftremit-api)
 *   OTEL_ENABLED                 – Set to "false" to disable tracing (default: true)
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const enabled = process.env.OTEL_ENABLED !== 'false';

if (enabled) {
  const exporter = new OTLPTraceExporter({
    url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'}/v1/traces`,
  });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'swiftremit-api',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '1.0.0',
    }),
    traceExporter: exporter,
    instrumentations: [
      new HttpInstrumentation({
        // Propagate W3C trace context (traceparent) on all outbound HTTP calls
        // so that requests to the backend service are linked in the trace.
        headersToSpanAttributes: {
          client: { requestHeaders: ['x-correlation-id'] },
        },
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  });

  sdk.start();
  console.log('[otel] API tracing started — exporting to', process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318');

  process.on('SIGTERM', () => sdk.shutdown().catch(console.error));
  process.on('SIGINT',  () => sdk.shutdown().catch(console.error));
}
