/**
 * Centralised error-response envelope for all endpoints.
 * SR-057
 *
 * Envelope: { error: { code, message, details?, correlation_id } }
 */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlation_id: string;
  };
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Map ContractError codes (1–52) to stable API error codes and HTTP statuses.
 */
export const CONTRACT_ERROR_MAP: Record<number, { code: string; status: number; message: string }> = {
  1: { code: 'CONTRACT_NOT_INITIALIZED', status: 400, message: 'Contract not initialized' },
  2: { code: 'CONTRACT_ALREADY_INITIALIZED', status: 409, message: 'Contract already initialized' },
  3: { code: 'UNAUTHORIZED', status: 403, message: 'Unauthorized access' },
  4: { code: 'INVALID_ESCROW', status: 404, message: 'Escrow not found' },
  5: { code: 'NOT_ESCROW_CLIENT', status: 403, message: 'Caller is not the escrow client' },
  7: { code: 'INVALID_AMOUNT', status: 400, message: 'Invalid amount' },
  8: { code: 'ESCROW_NOT_FOUND', status: 404, message: 'Escrow not found' },
  9: { code: 'INVALID_STATUS', status: 400, message: 'Invalid escrow status for this operation' },
  10: { code: 'MILESTONE_NOT_FOUND', status: 404, message: 'Milestone not found' },
  11: { code: 'INVALID_MILESTONE_STATUS', status: 400, message: 'Invalid milestone status' },
  12: { code: 'INSUFFICIENT_BALANCE', status: 400, message: 'Insufficient balance' },
  13: { code: 'TRANSFER_FAILED', status: 502, message: 'Token transfer failed' },
  14: { code: 'ALREADY_APPROVED', status: 409, message: 'Already approved' },
  15: { code: 'DISPUTE_ACTIVE', status: 409, message: 'Dispute is already active' },
  16: { code: 'NO_DISPUTE', status: 400, message: 'No active dispute' },
  17: { code: 'ARBITER_REQUIRED', status: 400, message: 'Arbiter required for this operation' },
  19: { code: 'DEADLINE_PASSED', status: 400, message: 'Deadline has passed' },
  20: { code: 'OVERFLOW', status: 400, message: 'Arithmetic overflow' },
  22: { code: 'PAUSED', status: 503, message: 'Contract is paused' },
  23: { code: 'FROZEN', status: 403, message: 'Escrow is frozen' },
  24: { code: 'NOT_FROZEN', status: 400, message: 'Escrow is not frozen' },
  26: { code: 'INVALID_FEE', status: 400, message: 'Invalid fee configuration' },
  28: { code: 'LOCK_TIME_ACTIVE', status: 400, message: 'Lock time is still active' },
  30: { code: 'TEMPLATE_NOT_FOUND', status: 404, message: 'Template not found' },
  31: { code: 'INVALID_SPLIT', status: 400, message: 'Invalid split configuration' },
  32: { code: 'RECURRING_NOT_FOUND', status: 404, message: 'Recurring config not found' },
  33: { code: 'INVALID_SCHEDULE', status: 400, message: 'Invalid schedule' },
  34: { code: 'BATCH_LIMIT', status: 400, message: 'Batch limit exceeded' },
  35: { code: 'NFT_GATE_FAILED', status: 403, message: 'NFT gate check failed' },
  36: { code: 'SIGNER_REQUIRED', status: 400, message: 'Required signer missing' },
  37: { code: 'DUPLICATE_SIGNER', status: 409, message: 'Duplicate signer' },
  38: { code: 'MULTISIG_THRESHOLD', status: 400, message: 'Multisig threshold not met' },
  39: { code: 'GOVERNANCE_REQUIRED', status: 403, message: 'Governance approval required' },
  40: { code: 'STAKING_ERROR', status: 400, message: 'Staking operation failed' },
  41: { code: 'BRIDGE_ERROR', status: 502, message: 'Bridge operation failed' },
  42: { code: 'ORACLE_ERROR', status: 502, message: 'Oracle query failed' },
  43: { code: 'REPUTATION_TOO_LOW', status: 403, message: 'Arbiter reputation too low' },
  44: { code: 'INVALID_TOKEN', status: 400, message: 'Token not approved' },
  45: { code: 'WHITELIST_ERROR', status: 400, message: 'Token whitelist error' },
  46: { code: 'ADMIN_TRANSFER_PENDING', status: 409, message: 'Admin transfer already pending' },
  47: { code: 'NO_ADMIN_TRANSFER', status: 400, message: 'No admin transfer pending' },
  51: { code: 'PARTIAL_CANCEL_ERROR', status: 400, message: 'Partial cancellation error' },
  52: { code: 'SELF_ESCROW_ERROR', status: 400, message: 'Self-escrow not allowed' },
};

/**
 * Map a contract error code to an API error.
 */
export function mapContractError(contractCode: number): ApiError {
  const mapping = CONTRACT_ERROR_MAP[contractCode];
  if (mapping) {
    return new ApiError(mapping.status, mapping.code, mapping.message);
  }
  return new ApiError(500, 'UNKNOWN_CONTRACT_ERROR', `Unknown contract error: ${contractCode}`);
}

/**
 * Generate a correlation ID for request tracing.
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Central Express error handler. Must be registered last.
 * Never leaks stack traces or SQL errors to clients.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const correlationId = (req as any).correlationId || generateCorrelationId();

  // Log full error internally with correlation ID
  console.error(`[${correlationId}]`, err.message, err.stack);

  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        correlation_id: correlationId,
      },
    });
    return;
  }

  // Zod validation errors
  if (err.name === 'ZodError' && 'issues' in err) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: (err as any).issues,
        correlation_id: correlationId,
      },
    });
    return;
  }

  // Default: internal error — never leak details
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred',
      correlation_id: correlationId,
    },
  });
}

/**
 * Middleware to attach correlation ID to every request.
 */
export function correlationMiddleware(req: Request, _res: Response, next: NextFunction): void {
  (req as any).correlationId = req.headers['x-correlation-id'] || generateCorrelationId();
  next();
}
