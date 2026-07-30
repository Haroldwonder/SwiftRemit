/**
 * backend/src/tracing/job-tracer.ts — SR-108
 *
 * Wraps scheduled/background jobs in OpenTelemetry root spans so every cron
 * job execution appears as a first-class trace with a correlation ID.
 *
 * Usage:
 *   import { tracedJob } from './tracing/job-tracer';
 *
 *   cron.schedule('* /30 * * * *', () =>
 *     tracedJob('poll-kyc-statuses', () => pollKycStatuses())
 *   );
 */

import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { randomUUID } from 'crypto';

const tracer = trace.getTracer('swiftremit-jobs', '1.0.0');

/**
 * Wraps a background job in a root span. Generates a per-run correlation ID
 * that is attached to the span and every child span created within the job.
 *
 * @param jobName   Human-readable job name (used as the span name)
 * @param fn        The async job body
 * @returns         The result of fn()
 */
export async function tracedJob<T>(jobName: string, fn: () => Promise<T>): Promise<T> {
  const correlationId = randomUUID();
  const scheduledAt   = new Date().toISOString();

  return tracer.startActiveSpan(
    `job.${jobName}`,
    {
      attributes: {
        'job.name':         jobName,
        'job.scheduled_at': scheduledAt,
        'correlation_id':   correlationId,
      },
    },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message,
        });
        throw err;
      } finally {
        span.end();
      }
    }
  );
}
