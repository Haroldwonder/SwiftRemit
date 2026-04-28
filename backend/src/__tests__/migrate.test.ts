import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';

// Mock pg Pool
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({
  query: mockQuery,
  release: mockRelease,
});
const mockPool = {
  query: mockQuery,
  connect: mockConnect,
};

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => mockPool),
}));

// Mock fs so we control which migration files exist
vi.mock('fs');

import { migrate, rollback } from '../migrate';

const FAKE_MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

describe('migrate()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // schema_migrations table exists, no applied migrations yet
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT filename FROM schema_migrations ORDER BY id')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    vi.mocked(fs.readdirSync).mockReturnValue(['001_init.sql', '002_add_index.sql'] as any);
    vi.mocked(fs.readFileSync).mockReturnValue('CREATE TABLE test (id SERIAL);' as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it('creates schema_migrations table on first run', async () => {
    await migrate(mockPool as any);
    const calls = mockQuery.mock.calls.map((c: any[]) => c[0] as string);
    expect(calls.some(s => s.includes('CREATE TABLE IF NOT EXISTS schema_migrations'))).toBe(true);
  });

  it('applies pending migrations in order', async () => {
    await migrate(mockPool as any);
    const insertCalls = mockQuery.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO schema_migrations')
    );
    expect(insertCalls.length).toBe(2);
    expect(insertCalls[0][1][0]).toBe('001_init.sql');
    expect(insertCalls[1][1][0]).toBe('002_add_index.sql');
  });

  it('skips already-applied migrations', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT filename FROM schema_migrations ORDER BY id')) {
        return Promise.resolve({ rows: [{ filename: '001_init.sql' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await migrate(mockPool as any);
    const insertCalls = mockQuery.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO schema_migrations')
    );
    // Only 002 should be applied
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0][1][0]).toBe('002_add_index.sql');
  });

  it('rolls back on SQL error and re-throws', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT filename FROM schema_migrations ORDER BY id')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql === 'CREATE TABLE test (id SERIAL);') {
        return Promise.reject(new Error('syntax error'));
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(migrate(mockPool as any)).rejects.toThrow('syntax error');
    const calls = mockQuery.mock.calls.map((c: any[]) => c[0] as string);
    expect(calls).toContain('ROLLBACK');
  });
});

describe('rollback()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('ORDER BY id DESC LIMIT 1')) {
        return Promise.resolve({ rows: [{ filename: '002_add_index.sql' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('DROP TABLE test;' as any);
  });

  it('executes the .down.sql file and removes the record', async () => {
    await rollback(mockPool as any);
    const deleteCalls = mockQuery.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('DELETE FROM schema_migrations')
    );
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0][1][0]).toBe('002_add_index.sql');
  });

  it('throws when no .down.sql file exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await expect(rollback(mockPool as any)).rejects.toThrow('No rollback file found');
  });
});
