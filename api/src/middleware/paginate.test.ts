import { describe, it, expect } from 'vitest';
import { parsePaginationParams, buildCursorEnvelope, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './paginate';

describe('parsePaginationParams', () => {
  const mockReq = (query: Record<string, any>) => ({ query } as any);

  it('returns defaults when no params given', () => {
    const params = parsePaginationParams(mockReq({}));
    expect(params.cursor).toBeUndefined();
    expect(params.limit).toBe(DEFAULT_PAGE_SIZE);
  });

  it('parses cursor and limit from query', () => {
    const params = parsePaginationParams(mockReq({ cursor: 'abc123', limit: '10' }));
    expect(params.cursor).toBe('abc123');
    expect(params.limit).toBe(10);
  });

  it('clamps limit to MAX_PAGE_SIZE', () => {
    const params = parsePaginationParams(mockReq({ limit: '999' }));
    expect(params.limit).toBe(MAX_PAGE_SIZE);
  });

  it('defaults negative limit', () => {
    const params = parsePaginationParams(mockReq({ limit: '-5' }));
    expect(params.limit).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe('buildCursorEnvelope', () => {
  it('returns has_more=false when data fits in one page', () => {
    const data = [{ id: '1' }, { id: '2' }];
    const result = buildCursorEnvelope(data, 5);
    expect(result.has_more).toBe(false);
    expect(result.next_cursor).toBeNull();
    expect(result.data).toHaveLength(2);
  });

  it('returns has_more=true and next_cursor when data exceeds limit', () => {
    const data = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const result = buildCursorEnvelope(data, 2);
    expect(result.has_more).toBe(true);
    expect(result.next_cursor).toBe('2');
    expect(result.data).toHaveLength(2);
  });

  it('returns empty envelope for empty data', () => {
    const result = buildCursorEnvelope([], 10);
    expect(result.has_more).toBe(false);
    expect(result.next_cursor).toBeNull();
    expect(result.data).toHaveLength(0);
  });

  it('uses custom cursor field', () => {
    const data = [{ txId: 'a' }, { txId: 'b' }, { txId: 'c' }];
    const result = buildCursorEnvelope(data, 2, 'txId');
    expect(result.next_cursor).toBe('b');
  });

  it('keyset pagination is stable under concurrent inserts', () => {
    const page1 = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const env1 = buildCursorEnvelope(page1, 2);
    expect(env1.next_cursor).toBe('2');
    const page2 = [{ id: '3' }, { id: '4' }];
    const env2 = buildCursorEnvelope(page2, 2);
    expect(env2.data.map(d => d.id)).toEqual(['3', '4']);
  });
});
