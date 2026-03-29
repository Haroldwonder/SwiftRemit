import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  getCorrelationContext, 
  getCorrelationId, 
  generateCorrelationId,
  withCorrelationContext,
  CorrelationContext 
} from '../correlation-id';

describe('Correlation ID', () => {
  beforeEach(() => {
    // Clear any existing correlation context
    // Note: In a real implementation, you might need to reset AsyncLocalStorage
  });

  it('should generate a valid UUID correlation ID', () => {
    const correlationId = generateCorrelationId();
    
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    expect(correlationId).toMatch(uuidRegex);
    expect(typeof correlationId).toBe('string');
    expect(correlationId.length).toBe(36);
  });

  it('should maintain correlation context across async operations', async () => {
    const context: CorrelationContext = {
      correlationId: 'test-correlation-id',
      startTime: Date.now(),
      userId: 'test-user',
      anchorId: 'test-anchor',
      transactionId: 'test-transaction'
    };

    let capturedContext: CorrelationContext | undefined;
    
    await withCorrelationContext(context, async () => {
      capturedContext = getCorrelationContext();
      
      // Verify context is available in async operation
      expect(getCorrelationId()).toBe('test-correlation-id');
      expect(capturedContext).toBeDefined();
      expect(capturedContext?.correlationId).toBe('test-correlation-id');
      expect(capturedContext?.userId).toBe('test-user');
      expect(capturedContext?.anchorId).toBe('test-anchor');
      expect(capturedContext?.transactionId).toBe('test-transaction');
    });

    // Verify context is captured correctly
    expect(capturedContext).toEqual(context);
  });

  it('should return undefined when no correlation context is set', () => {
    expect(getCorrelationContext()).toBeUndefined();
    expect(getCorrelationId()).toBeUndefined();
  });

  it('should handle nested async operations with same correlation context', async () => {
    const context: CorrelationContext = {
      correlationId: 'nested-test-id',
      startTime: Date.now()
    };

    let outerContext: CorrelationContext | undefined;
    let innerContext: CorrelationContext | undefined;

    await withCorrelationContext(context, async () => {
      outerContext = getCorrelationContext();
      
      // Nested async operation
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await withCorrelationContext(context, async () => {
        innerContext = getCorrelationContext();
        expect(getCorrelationId()).toBe('nested-test-id');
      });
    });

    expect(outerContext?.correlationId).toBe('nested-test-id');
    expect(innerContext?.correlationId).toBe('nested-test-id');
  });

  it('should handle multiple correlation contexts in parallel', async () => {
    const context1: CorrelationContext = {
      correlationId: 'parallel-test-1',
      startTime: Date.now()
    };

    const context2: CorrelationContext = {
      correlationId: 'parallel-test-2',
      startTime: Date.now()
    };

    let result1: string | undefined;
    let result2: string | undefined;

    // Run both contexts in parallel
    await Promise.all([
      withCorrelationContext(context1, async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        result1 = getCorrelationId();
      }),
      withCorrelationContext(context2, async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        result2 = getCorrelationId();
      })
    ]);

    expect(result1).toBe('parallel-test-1');
    expect(result2).toBe('parallel-test-2');
    expect(result1).not.toBe(result2);
  });

  it('should handle errors in async operations', async () => {
    const context: CorrelationContext = {
      correlationId: 'error-test-id',
      startTime: Date.now()
    };

    let errorCaught = false;

    try {
      await withCorrelationContext(context, async () => {
        expect(getCorrelationId()).toBe('error-test-id');
        throw new Error('Test error');
      });
    } catch (error) {
      errorCaught = true;
      expect((error as Error).message).toBe('Test error');
    }

    expect(errorCaught).toBe(true);
    // Context should not be available after error
    expect(getCorrelationId()).toBeUndefined();
  });

  it('should generate unique correlation IDs', () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    
    expect(id1).not.toBe(id2);
    
    // Generate multiple IDs to ensure uniqueness
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateCorrelationId());
    }
    
    expect(ids.size).toBe(100);
  });

  it('should handle context with partial data', async () => {
    const context: CorrelationContext = {
      correlationId: 'partial-test-id',
      startTime: Date.now()
      // userId, anchorId, transactionId are undefined
    };

    await withCorrelationContext(context, async () => {
      const currentContext = getCorrelationContext();
      expect(currentContext).toBeDefined();
      expect(currentContext?.correlationId).toBe('partial-test-id');
      expect(currentContext?.userId).toBeUndefined();
      expect(currentContext?.anchorId).toBeUndefined();
      expect(currentContext?.transactionId).toBeUndefined();
    });
  });
});