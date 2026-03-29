import { Request, Response, NextFunction } from 'express';
import { 
  getCorrelationContext, 
  getCorrelationId, 
  generateCorrelationId, 
  withCorrelationContext,
  CorrelationContext 
} from './correlation-id';

/**
 * Express middleware to generate and propagate correlation IDs
 */
export function correlationIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Check if correlation ID is already provided in headers
    const providedCorrelationId = req.headers['x-correlation-id'] as string;
    const correlationId = providedCorrelationId || generateCorrelationId();
    
    // Extract additional context from request
    const userId = req.headers['x-user-id'] as string;
    const anchorId = req.headers['x-anchor-id'] as string;
    const transactionId = req.body?.transaction_id || req.params?.transactionId;

    // Create correlation context
    const context: CorrelationContext = {
      correlationId,
      startTime: Date.now(),
      userId,
      anchorId,
      transactionId,
    };

    // Set the correlation ID in response headers
    res.setHeader('X-Correlation-ID', correlationId);

    // Execute the request handler with correlation context
    withCorrelationContext(context, () => {
      // Add correlation ID to request object for access in handlers
      (req as any).correlationId = correlationId;
      
      next();
    }).catch(next);
  };
}

/**
 * Async wrapper for Express route handlers to maintain correlation context
 */
export function withCorrelationContextHandler<T extends (...args: any[]) => any>(
  handler: T
): T {
  return ((req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCorrelationId();
    
    if (!correlationId) {
      // If no correlation context, generate one and wrap
      const context: CorrelationContext = {
        correlationId: generateCorrelationId(),
        startTime: Date.now(),
        userId: req.headers['x-user-id'] as string,
        anchorId: req.headers['x-anchor-id'] as string,
        transactionId: req.body?.transaction_id || req.params?.transactionId,
      };

      return withCorrelationContext(context, () => {
        (req as any).correlationId = context.correlationId;
        res.setHeader('X-Correlation-ID', context.correlationId);
        return handler(req, res, next);
      });
    }

    return handler(req, res, next);
  }) as T;
}