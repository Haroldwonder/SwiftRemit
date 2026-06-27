import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, buildCursorWhereClause, getNextCursor } from '../services/cursor-pagination';

describe('Cursor Pagination', () => {
  it('should encode and decode cursor correctly', () => {
    const id = '123';
    const cursor = encodeCursor(id);
    expect(typeof cursor).toBe('string');
    expect(cursor).not.toContain('123'); // Should be encoded
    
    const decoded = decodeCursor(cursor);
    expect(decoded).toBe(id);
  });

  it('should handle numeric IDs', () => {
    const id = 456;
    const cursor = encodeCursor(id);
    const decoded = decodeCursor(cursor);
    expect(decoded).toBe(String(id));
  });

  it('should reject invalid cursor formats', () => {
    const invalidCursor = Buffer.from('invalid').toString('base64');
    expect(() => decodeCursor(invalidCursor)).toThrow('Invalid cursor format');
  });

  it('should build WHERE clause without cursor', () => {
    const { where, params } = buildCursorWhereClause();
    expect(where).toBe('');
    expect(params).toHaveLength(0);
  });

  it('should build WHERE clause with valid cursor', () => {
    const cursor = encodeCursor('789');
    const { where, params } = buildCursorWhereClause(cursor);
    expect(where).toContain('id >');
    expect(params).toContain('789');
  });

  it('should throw on invalid cursor in WHERE clause', () => {
    const invalidCursor = 'not-a-valid-cursor';
    expect(() => buildCursorWhereClause(invalidCursor)).toThrow();
  });

  it('should compute next cursor from result set', () => {
    const items = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 3, name: 'c' },
    ];
    
    const limit = 2;
    const requestedLimit = 2;
    
    // If items.length > requestedLimit, next cursor exists
    const result = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 3, name: 'c' },
    ];
    
    const nextCursor = getNextCursor(result, limit + 1, requestedLimit);
    expect(nextCursor).not.toBeNull();
  });

  it('should return null next cursor when no more items', () => {
    const items = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ];
    
    const limit = 2;
    const requestedLimit = 2;
    
    const nextCursor = getNextCursor(items, limit, requestedLimit);
    expect(nextCursor).toBeNull();
  });

  it('should support pagination across multiple calls', () => {
    const allItems = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `item${i + 1}` }));
    const limit = 20;
    
    let cursor: string | null = null;
    let pageCount = 0;
    let itemCount = 0;
    
    for (let page = 0; page < 6; page++) {
      let startIdx = 0;
      if (cursor) {
        const decodedId = decodeCursor(cursor);
        startIdx = allItems.findIndex(item => String(item.id) === decodedId);
        if (startIdx >= 0) startIdx++;
      }
      
      const items = allItems.slice(startIdx, startIdx + limit);
      if (items.length === 0) break;
      
      itemCount += items.length;
      pageCount++;
      
      const hasMore = startIdx + limit < allItems.length;
      cursor = hasMore && items.length > 0 ? encodeCursor(items[items.length - 1].id) : null;
      
      if (!cursor) break;
    }
    
    expect(pageCount).toBe(5); // 100 items / 20 per page
    expect(itemCount).toBe(100);
  });

  it('should maintain consistent ordering across cursor pagination', () => {
    const items = [
      { id: 10, name: 'a' },
      { id: 20, name: 'b' },
      { id: 30, name: 'c' },
      { id: 40, name: 'd' },
    ];

    // First page
    const page1 = items.slice(0, 2);
    const cursor1 = encodeCursor(page1[1].id);

    // Second page
    let page2Index = 0;
    const decodedId = decodeCursor(cursor1);
    page2Index = items.findIndex(i => String(i.id) === decodedId);
    if (page2Index >= 0) page2Index++;

    const page2 = items.slice(page2Index, page2Index + 2);

    expect(page1[0].id).toBe(10);
    expect(page1[1].id).toBe(20);
    expect(page2[0].id).toBe(30);
    expect(page2[1].id).toBe(40);
  });
});
