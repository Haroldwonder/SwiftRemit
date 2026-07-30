import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { trace } from '@opentelemetry/api';
import { redact as sharedRedact, StructuredLogger as SharedLogger } from '../../shared/src/logger';

// ── AsyncLocalStorage for correlation IDs ────────────────────────────────────

// AsyncLocalStorage to maintain correlation ID across async operations.
// Exported so job-tracker (and any other non-Express entry point) can call
// correlationStorage.run(id, fn) to establish a correlation context without
// going through HTTP middleware.
export const correlationStorage = new AsyncLocalStorage<string>();



export function getCorrelationIdFromRequest(req: Request): string | undefined {
  return (req as any).correlationId;
}

export function setCorrelationId(id: string): void {
  correlationStorage.enterWith(id);
}

/**
 * Middleware to generate and propagate correlation IDs.
 * Reads x-correlation-id from the request header; generates a UUID if absent.
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();

  correlationStorage.run(correlationId, () => {
    (req as any).correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);
    next();
  });
}

// ── Re-export shared redact so tests can import from one place ───────────────
export { sharedRedact as redact };

// ── Backend StructuredLogger ─────────────────────────────────────────────────
// Extends the shared logger with OpenTelemetry trace/span context and
// AsyncLocalStorage correlation IDs.

/**
 * Get the current correlation ID from AsyncLocalStorage
 */
export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore();
}

export class StructuredLogger extends SharedLogger {

  private correlationAwareFormat(
    level: string,
    message: string,
    data?: unknown,
  ): string {
    const correlationId = getCorrelationId();
    const activeSpan = trace.getActiveSpan();
    const spanContext = activeSpan?.spanContext();
    const traceId = spanContext?.traceId;
    const spanId = spanContext?.spanId;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: (this as any).context as string,
      correlationId,
      ...(traceId && { traceId }),
      ...(spanId && { spanId }),
      message,
      ...(data ? { data: sharedRedact(data) } : {}),
    };
    return JSON.stringify(logEntry);
  }

  override info(message: string, data?: unknown): void {
    console.log(this.correlationAwareFormat('INFO', message, data));
  }

  override warn(message: string, data?: unknown): void {
    console.warn(this.correlationAwareFormat('WARN', message, data));
  }

  override error(message: string, error?: Error | unknown, data?: unknown): void {
    const errorData =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error;
    console.error(
      this.correlationAwareFormat('ERROR', message, { ...(data as object), error: errorData }),
    );
  }

  override debug(message: string, data?: unknown): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.correlationAwareFormat('DEBUG', message, data));
    }
  }
}

export function createLogger(context: string): StructuredLogger {
  return new StructuredLogger(context);
}
