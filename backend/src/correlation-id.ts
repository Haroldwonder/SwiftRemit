import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';

export interface CorrelationContext {
  correlationId: string;
  startTime: number;
  userId?: string;
  anchorId?: string;
  transactionId?: string;
}

/**
 * AsyncLocalStorage to maintain correlation context across async operations
 */
const asyncLocalStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Get the current correlation context
 */
export function getCorrelationContext(): CorrelationContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Get the current correlation ID
 */
export function getCorrelationId(): string | undefined {
  return asyncLocalStorage.getStore()?.correlationId;
}

/**
 * Execute a function with correlation context
 */
export function withCorrelationContext<T>(
  context: CorrelationContext,
  fn: () => T | Promise<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    asyncLocalStorage.run(context, async () => {
      try {
        const result = await Promise.resolve(fn());
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Generate a new correlation ID
 */
export function generateCorrelationId(): string {
  return uuidv4();
}