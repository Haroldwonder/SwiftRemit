import { describe, it, expect, vi } from 'vitest';

// Capture the attributes passed to startActiveSpan so we can compare the
// span's correlation_id attribute against the correlation ID observed by a
// logger running inside the traced job body.
const spanAttributes: Record<string, unknown>[] = [];

vi.mock('@opentelemetry/api', () => {
  const fakeSpan = {
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  };
  return {
    trace: {
      getTracer: () => ({
        startActiveSpan: (_name: string, opts: { attributes: Record<string, unknown> }, fn: (span: unknown) => unknown) => {
          spanAttributes.push(opts.attributes);
          return fn(fakeSpan);
        },
      }),
    },
    context: {},
    SpanStatusCode: { OK: 1, ERROR: 2 },
  };
});

describe('tracedJob correlation ID propagation', () => {
  it('makes the span correlation_id available to getCorrelationId() inside the job body', async () => {
    const { tracedJob } = await import('../tracing/job-tracer');
    const { getCorrelationId } = await import('../correlation-id');

    let observedDuringRun: string | undefined;

    await tracedJob('test-job', async () => {
      observedDuringRun = getCorrelationId();
    });

    const recordedCorrelationId = spanAttributes[spanAttributes.length - 1]['correlation_id'] as string;

    expect(observedDuringRun).toBeDefined();
    expect(observedDuringRun).toBe(recordedCorrelationId);
  });

  it('produces a structured log line whose correlationId matches the span attribute', async () => {
    const { tracedJob } = await import('../tracing/job-tracer');
    const { createLogger } = await import('../correlation-id');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await tracedJob('test-job-with-log', async () => {
      const logger = createLogger('test');
      logger.info('doing work');
    });

    const logged = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1][0] as string);
    const recordedCorrelationId = spanAttributes[spanAttributes.length - 1]['correlation_id'] as string;

    expect(logged.correlationId).toBe(recordedCorrelationId);

    logSpy.mockRestore();
  });
});
