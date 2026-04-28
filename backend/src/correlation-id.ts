import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// AsyncLocalStorage to maintain correlation ID across async operations
const correlationStorage = new AsyncLocalStorage<string>();

/**
 * Get the current correlation ID from AsyncLocalStorage
 */
export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore();
}

/**
 * Get correlation ID from Express request object
 */
export function getCorrelationIdFromRequest(req: Request): string | undefined {
  return (req as any).correlationId;
}

/**
 * Set correlation ID in AsyncLocalStorage
 */
export function setCorrelationId(id: string): void {
  correlationStorage.enterWith(id);
}

/**
 * Middleware to generate and propagate correlation ID
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Check if correlation ID is provided in request header
  const correlationId = req.headers['x-correlation-id'] as string || uuidv4();
  
  // Set correlation ID in AsyncLocalStorage
  correlationStorage.run(correlationId, () => {
    // Add correlation ID to request object for easy access
    (req as any).correlationId = correlationId;
    
    // Set correlation ID in response header
    res.setHeader('X-Correlation-ID', correlationId);
    
    // Continue to next middleware
    next();
  });
}

/**
 * Enhanced logger with correlation ID support
 */
export class StructuredLogger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const correlationId = getCorrelationId();
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      correlationId,
      message,
      ...(data && { data }),
    };
    return JSON.stringify(logEntry);
  }

  info(message: string, data?: any): void {
    console.log(this.formatMessage('INFO', message, data));
  }

  warn(message: string, data?: any): void {
    console.warn(this.formatMessage('WARN', message, data));
  }

  error(message: string, error?: Error | any, data?: any): void {
    const errorData = error instanceof Error 
      ? { name: error.name, message: error.message, stack: error.stack }
      : error;
    console.error(this.formatMessage('ERROR', message, { ...data, error: errorData }));
  }

  debug(message: string, data?: any): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.formatMessage('DEBUG', message, data));
    }
  }
}

/**
 * Create a logger instance for a specific context
 */
export function createLogger(context: string): StructuredLogger {
  return new StructuredLogger(context);
}
