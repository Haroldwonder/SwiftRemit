/**
 * Cursor pagination middleware for Express routes.
 * Applies createCursorPagination to any list endpoint.
 *
 * SR-051
 */
import { Request, Response, NextFunction } from 'express';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

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
 * Clamps page_size to MAX_PAGE_SIZE.
 */
export function parsePaginationParams(req: Request): PaginationParams {
  const cursor = req.query.cursor as string | undefined;
  let limit = parseInt(req.query.limit as string, 10) || DEFAULT_PAGE_SIZE;

  if (limit < 1) limit = DEFAULT_PAGE_SIZE;
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
  const params = parsePaginationParams(req);
  (req as any).pagination = params;
  next();
}
