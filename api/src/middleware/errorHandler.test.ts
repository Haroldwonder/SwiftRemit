import { describe, it, expect, vi } from 'vitest';
import { ApiError, errorHandler, mapContractError, CONTRACT_ERROR_MAP, correlationMiddleware, generateCorrelationId } from './errorHandler';

function mockReqRes() {
  const req = { headers: {}, correlationId: undefined } as any;
  const statusFn = vi.fn().mockReturnThis();
  const jsonFn = vi.fn();
  const res = { status: statusFn, json: jsonFn } as any;
  const next = vi.fn();
  return { req, res, next, statusFn, jsonFn };
}

describe('Error Envelope (SR-057)', () => {
  it('returns standard envelope for ApiError', () => {
    const { req, res, next } = mockReqRes();
    req.correlationId = 'test-123';
    const err = new ApiError(400, 'INVALID_AMOUNT', 'Amount must be positive');
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('INVALID_AMOUNT');
    expect(body.error.message).toBe('Amount must be positive');
    expect(body.error.correlation_id).toBe('test-123');
  });

  it('returns standard envelope for unknown errors without leaking details', () => {
    const { req, res, next } = mockReqRes();
    req.correlationId = 'test-456';
    const err = new Error('SQL syntax error at line 42');
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An internal error occurred');
    expect(body.error.message).not.toContain('SQL');
    expect(body.error.correlation_id).toBe('test-456');
  });

  it('handles ZodError with validation details', () => {
    const { req, res, next } = mockReqRes();
    req.correlationId = 'test-789';
    const err = Object.assign(new Error('Validation'), {
      name: 'ZodError',
      issues: [{ path: ['amount'], message: 'Required' }],
    });
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveLength(1);
  });

  it('includes details in ApiError when provided', () => {
    const { req, res, next } = mockReqRes();
    req.correlationId = 'test-det';
    const err = new ApiError(422, 'INVALID_INPUT', 'Bad input', { field: 'email' });
    errorHandler(err, req, res, next);
    const body = res.json.mock.calls[0][0];
    expect(body.error.details).toEqual({ field: 'email' });
  });

  it('never leaks stack traces', () => {
    const { req, res, next } = mockReqRes();
    const err = new Error('secret DB connection string');
    errorHandler(err, req, res, next);
    const body = res.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('stack');
  });

  it('maps all 35 contract error codes', () => {
    const codes = Object.keys(CONTRACT_ERROR_MAP).map(Number);
    expect(codes.length).toBeGreaterThanOrEqual(35);
    for (const code of codes) {
      const apiErr = mapContractError(code);
      expect(apiErr).toBeInstanceOf(ApiError);
      expect(apiErr.code).toBeTruthy();
      expect(apiErr.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it('maps unknown contract error to 500', () => {
    const apiErr = mapContractError(999);
    expect(apiErr.statusCode).toBe(500);
    expect(apiErr.code).toBe('UNKNOWN_CONTRACT_ERROR');
  });
});

describe('Correlation middleware', () => {
  it('generates a correlation ID when none provided', () => {
    const { req, res, next } = mockReqRes();
    correlationMiddleware(req, res, next);
    expect(req.correlationId).toBeTruthy();
    expect(next).toHaveBeenCalled();
  });

  it('uses existing x-correlation-id header', () => {
    const { req, res, next } = mockReqRes();
    req.headers['x-correlation-id'] = 'external-123';
    correlationMiddleware(req, res, next);
    expect(req.correlationId).toBe('external-123');
  });
});

describe('generateCorrelationId', () => {
  it('produces unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateCorrelationId()));
    expect(ids.size).toBe(100);
  });
});
