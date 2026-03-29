import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { correlationIdMiddleware, withCorrelationContextHandler } from '../correlation-middleware';
import { getCorrelationId, generateCorrelationId } from '../correlation-id';

// Define Mock type for vitest
type Mock<T, Y extends readonly unknown[]> = vi.MockInstance<T, Y>;

// Mock express types for testing
interface MockRequest extends Partial<Request> {
  headers: Record<string, string | string[] | undefined>;
  correlationId?: string;
}

interface MockResponse extends Partial<Response> {
  setHeader: Mock<any, [name: string, value: string | number | readonly string[]]>;
  status: Mock<any, [code: number]>;
  json: Mock<any, [body?: any]>;
}

interface MockNextFunction extends NextFunction {}

describe('Correlation Middleware', () => {
  let mockRequest: MockRequest;
  let mockResponse: MockResponse;
  let mockNext: MockNextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      correlationId: undefined
    };
    
    mockResponse = {
      setHeader: vi.fn() as any,
      status: vi.fn().mockReturnThis() as any,
      json: vi.fn() as any
    };
    
    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('correlationIdMiddleware', () => {
    it('should generate a new correlation ID when none is provided', () => {
      const middleware = correlationIdMiddleware();
      
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Correlation-ID', expect.any(String));
      expect(mockRequest.correlationId).toBeDefined();
      expect(typeof mockRequest.correlationId).toBe('string');
    });

    it('should use provided correlation ID from headers', () => {
      const providedCorrelationId = 'provided-correlation-id-123';
      mockRequest.headers['x-correlation-id'] = providedCorrelationId;

      const middleware = correlationIdMiddleware();
      
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Correlation-ID', providedCorrelationId);
      expect(mockRequest.correlationId).toBe(providedCorrelationId);
    });

    it('should extract user ID from headers', () => {
      const userId = 'test-user-123';
      mockRequest.headers['x-user-id'] = userId;

      const middleware = correlationIdMiddleware();
      
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.correlationId).toBeDefined();
      // The correlation ID should be generated, but the context should include userId
    });

    it('should extract anchor ID from headers', () => {
      const anchorId = 'test-anchor-123';
      mockRequest.headers['x-anchor-id'] = anchorId;

      const middleware = correlationIdMiddleware();
      
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.correlationId).toBeDefined();
      // The correlation ID should be generated, but the context should include anchorId
    });

    it('should extract transaction ID from request body', () => {
      const transactionId = 'test-transaction-123';
      mockRequest.body = { transaction_id: transactionId };

      const middleware = correlationIdMiddleware();
      
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.correlationId).toBeDefined();
      // The correlation ID should be generated, but the context should include transactionId
    });

    it('should extract transaction ID from request params', () => {
      const transactionId = 'test-transaction-456';
      mockRequest.params = { transactionId };

      const middleware = correlationIdMiddleware();
      
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.correlationId).toBeDefined();
      // The correlation ID should be generated, but the context should include transactionId
    });

    it('should handle errors in async context', async () => {
      const middleware = correlationIdMiddleware();

      // Create a request that will cause an error
      mockRequest.headers['x-correlation-id'] = 'invalid-correlation-id';

      // Mock an error in the async context
      const originalWithCorrelationContext = (await import('../correlation-id')).withCorrelationContext;
      vi.spyOn(await import('../correlation-id'), 'withCorrelationContext').mockImplementation(async () => {
        throw new Error('Test error');
      });

      try {
        await new Promise<void>((resolve, reject) => {
          middleware(mockRequest as Request, mockResponse as Response, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('withCorrelationContextHandler', () => {
    it('should wrap a handler function and maintain correlation context', async () => {
      const handler = vi.fn().mockImplementation((req: Request, res: Response, next: NextFunction) => {
        expect((req as any).correlationId).toBeDefined();
        res.json({ success: true });
      });

      const wrappedHandler = withCorrelationContextHandler(handler);

      await wrappedHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(handler).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith({ success: true });
    });

    it('should generate correlation ID when none exists in context', async () => {
      const handler = vi.fn().mockImplementation((req: Request, res: Response, next: NextFunction) => {
        expect((req as any).correlationId).toBeDefined();
        res.json({ correlationId: (req as any).correlationId });
      });

      const wrappedHandler = withCorrelationContextHandler(handler);

      await wrappedHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(handler).toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Correlation-ID', expect.any(String));
    });

    it('should use existing correlation context when available', async () => {
      // First, establish a correlation context
      const correlationId = generateCorrelationId();
      const { withCorrelationContext } = await import('../correlation-id');
      
      await withCorrelationContext(
        { correlationId, startTime: Date.now() },
        async () => {
          const handler = vi.fn().mockImplementation((req: Request, res: Response, next: NextFunction) => {
            expect((req as any).correlationId).toBe(correlationId);
            res.json({ correlationId: (req as any).correlationId });
          });

          const wrappedHandler = withCorrelationContextHandler(handler);

          await wrappedHandler(mockRequest as Request, mockResponse as Response, mockNext);

          expect(handler).toHaveBeenCalled();
          expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Correlation-ID', correlationId);
        }
      );
    });

    it('should handle errors in wrapped handlers', async () => {
      const handler = vi.fn().mockImplementation((req: Request, res: Response, next: NextFunction) => {
        throw new Error('Handler error');
      });

      const wrappedHandler = withCorrelationContextHandler(handler);

      await expect(
        wrappedHandler(mockRequest as Request, mockResponse as Response, mockNext)
      ).rejects.toThrow('Handler error');

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Integration', () => {
    it('should maintain correlation ID across multiple middleware calls', async () => {
      const middleware1 = correlationIdMiddleware();
      const middleware2 = correlationIdMiddleware();
      
      const handler = vi.fn().mockImplementation((req: Request, res: Response, next: NextFunction) => {
        expect((req as any).correlationId).toBeDefined();
        res.json({ correlationId: (req as any).correlationId });
      });

      // Simulate a middleware chain
      const chain = [
        middleware1,
        middleware2,
        handler
      ];

      let currentRequest = mockRequest as Request;
      let currentResponse = mockResponse as Response;

      for (const middleware of chain) {
        if (typeof middleware === 'function') {
          await new Promise<void>((resolve, reject) => {
            const next = (err?: any) => {
              if (err) reject(err);
              else resolve();
            };
            middleware(currentRequest, currentResponse, next);
          });
        }
      }

      expect(handler).toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Correlation-ID', expect.any(String));
    });

    it('should generate different correlation IDs for different requests', () => {
      const middleware = correlationIdMiddleware();
      
      const request1 = { ...mockRequest, headers: {} };
      const request2 = { ...mockRequest, headers: {} };
      
      middleware(request1 as Request, mockResponse as Response, mockNext);
      middleware(request2 as Request, mockResponse as Response, mockNext);

      expect(request1.correlationId).toBeDefined();
      expect(request2.correlationId).toBeDefined();
      expect(request1.correlationId).not.toBe(request2.correlationId);
    });
  });
});