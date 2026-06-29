/**
 * Cursor-based pagination utilities for consistent pagination across all list endpoints.
 * Avoids offset pagination issues (inefficiency, instability with concurrent inserts).
 */

export interface CursorPaginationResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CursorPaginationParams {
  cursor?: string | null;
  limit: number;
}

/**
 * Encode a cursor from a record ID.
 * Simple base64 encoding for opacity.
 */
export function encodeCursor(id: number | string): string {
  return Buffer.from(`id:${id}`).toString('base64');
}

/**
 * Decode a cursor to extract the ID.
 */
export function decodeCursor(cursor: string): string {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    if (decoded.startsWith('id:')) {
      return decoded.substring(3);
    }
    throw new Error('Invalid cursor format');
  } catch {
    throw new Error('Invalid cursor format');
  }
}

/**
 * Build a SQL WHERE clause for cursor-based pagination.
 * Assumes records are ordered by ID ascending.
 */
export function buildCursorWhereClause(cursor?: string | null): { where: string; params: (string | number)[] } {
  if (!cursor) {
    return { where: '', params: [] };
  }

  try {
    const decodedId = decodeCursor(cursor);
    return {
      where: 'AND id > $1',
      params: [decodedId],
    };
  } catch {
    throw new Error('Invalid cursor');
  }
}

/**
 * Extract next cursor from result set.
 * If we got limit+1 rows, use the last row ID as next cursor.
 */
export function getNextCursor<T extends { id: number | string }>(
  items: T[],
  limit: number,
  requestedLimit: number,
): string | null {
  if (items.length <= requestedLimit) {
    return null; // No more items
  }
  // Items has limit+1, so next cursor is the last item's ID
  return encodeCursor(items[items.length - 1].id);
}
