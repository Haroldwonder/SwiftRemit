/**
 * Shared cursor-pagination primitives for Express list endpoints (SR-051).
 *
 * These utilities are the canonical building blocks for keyset/cursor
 * pagination across this service.  Any list route that needs paginated
 * output — GET /anchors, GET /admin/webhooks/dlq, analytics list endpoints,
 * etc. — should import `parsePaginationParams` and `buildCursorEnvelope`
 * from here rather than rolling its own query-string parsing.
 *
 * Note: the former routes/paginatedRemittances.ts demo stub has been removed
 * (SR-164).  The real, working cursor-paginated remittances endpoint lives in
 * routes/remittances.ts and is mounted at /api/remittances.
 */
import { Request, Response, NextFunction } from 'express';
import { ApiError } from './errorHandler';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_CURSOR_LENGTH = 256;

export interface PaginationParams {
  cursor?: string;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
  page_size: number;
}

/**
 * Extract and validate pagination params from query string.
 * Throws a 400 INVALID_LIMIT ApiError for non-integer or non-positive limits.
 * Throws a 400 INVALID_CURSOR ApiError for non-string cursors (e.g. repeated
 * query params yielding an array) or cursors longer than MAX_CURSOR_LENGTH.
 * Clamps page_size to MAX_PAGE_SIZE.
 */
export function parsePaginationParams(req: Request): PaginationParams {
  const rawCursor = req.query.cursor;
  let cursor: string | undefined;

  if (rawCursor !== undefined && rawCursor !== null && rawCursor !== '') {
    if (typeof rawCursor !== 'string') {
      throw new ApiError(
        400,
        'INVALID_CURSOR',
        '`cursor` must be a single string value',
      );
    }
    if (rawCursor.length > MAX_CURSOR_LENGTH) {
      throw new ApiError(
        400,
        'INVALID_CURSOR',
        `\`cursor\` must not exceed ${MAX_CURSOR_LENGTH} characters`,
      );
    }
    cursor = rawCursor;
  }

  const rawLimit = req.query.limit;

  let limit = DEFAULT_PAGE_SIZE;
  if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
    const parsed = typeof rawLimit === 'string' && /^\d+$/.test(rawLimit.trim())
      ? parseInt(rawLimit.trim(), 10)
      : NaN;

    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new ApiError(
        400,
        'INVALID_LIMIT',
        `\`limit\` must be a positive integer between 1 and ${MAX_PAGE_SIZE}`,
      );
    }
    limit = parsed;
  }

  if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;

  return { cursor, limit };
}

/**
 * Build a cursor envelope response from a data array.
 * Assumes data was fetched with limit+1 to detect has_more.
 */
export function buildCursorEnvelope<T extends Record<string, any>>(
  data: T[],
  limit: number,
  cursorField: string = 'id'
): PaginatedResponse<T> {
  const has_more = data.length > limit;
  const page = has_more ? data.slice(0, limit) : data;
  const next_cursor = has_more && page.length > 0
    ? String(page[page.length - 1][cursorField])
    : null;

  return {
    data: page,
    next_cursor,
    has_more,
    page_size: page.length,
  };
}

/**
 * Express middleware that attaches pagination helpers to req.
 */
export function paginationMiddleware(req: Request, _res: Response, next: NextFunction): void {
  try {
    const params = parsePaginationParams(req);
    (req as any).pagination = params;
    next();
  } catch (err) {
    next(err);
  }
}
