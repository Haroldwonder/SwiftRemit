/**
 * OpenTelemetry instrumentation for SwiftRemit API service. — SR-108
 *
 * Import this module FIRST (before any other imports) in index.ts so that
 * auto-instrumentation patches are applied before the libraries are loaded.
 *
 * Environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  – OTLP HTTP endpoint (default: http://localhost:4318)
 *   OTEL_SERVICE_NAME            – Service name reported in traces (default: swiftremit-api)
 *   OTEL_ENABLED                 – Set to "false" to disable tracing (default: true)
 *   OTEL_TRACES_SAMPLER          – Sampler type (default: parentbased_traceidratio)
 *   OTEL_TRACES_SAMPLER_ARG      – Sampler ratio (default: 0.1 in prod, 1.0 in dev)
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

const enabled = process.env.OTEL_ENABLED !== 'false';

/**
 * Build the configured sampler.
 * See backend/src/tracing.ts for documentation on OTEL_TRACES_SAMPLER values.
 */
function buildSampler() {
  const samplerType = process.env.OTEL_TRACES_SAMPLER ?? 'parentbased_traceidratio';
  const isDev = (process.env.NODE_ENV ?? 'production') === 'development';
  const defaultRatio = isDev ? 1.0 : 0.1;
  const ratio = parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG ?? String(defaultRatio));

  switch (samplerType) {
    case 'always_on':              return new AlwaysOnSampler();
    case 'always_off':             return new AlwaysOffSampler();
    case 'traceidratio':           return new TraceIdRatioBasedSampler(ratio);
    case 'parentbased_traceidratio':
    default:
      return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) });
  }
}

if (enabled) {
  const endpoint = process.env.JAEGER_ENDPOINT
    ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ?? 'http://localhost:4318';

  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]:    process.env.OTEL_SERVICE_NAME ?? 'swiftremit-api',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '1.0.0',
    }),
    traceExporter: exporter,
    sampler: buildSampler(),
    instrumentations: [
      new HttpInstrumentation({
        // Extract W3C traceparent from incoming requests (browser/mobile → API)
        headersToSpanAttributes: {
          client: { requestHeaders: ['x-correlation-id', 'traceparent'] },
          server: { requestHeaders: ['x-correlation-id', 'traceparent'] },
        },
        // Echo trace ID on responses so browser can correlate with backend spans
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
    `[otel] API tracing started — endpoint=${endpoint} sampler=${process.env.OTEL_TRACES_SAMPLER ?? 'parentbased_traceidratio'}`
  );

  process.on('SIGTERM', () => sdk.shutdown().catch(console.error));
  process.on('SIGINT',  () => sdk.shutdown().catch(console.error));
}
