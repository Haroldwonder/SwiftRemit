/**
 * Tests for GET /api/remittances search and filter (Issue #882).
 *
 * Verifies all new query parameters: status, from_date, to_date,
 * corridor, min_amount, max_amount, and combined filters.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { Application } from 'express';
import { RemittanceStore, Remittance, PaginatedResult } from '../db/remittanceStore';
import { RemittanceStatus } from '../websocket/types';

/** Minimal in-memory store stub for filter tests */
class StubRemittanceStore implements RemittanceStore {
  constructor(private readonly rows: Remittance[]) {}

  async getById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async create(r: Omit<Remittance, 'created_at' | 'updated_at'>): Promise<Remittance> {
    const row: Remittance = { ...r, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    this.rows.push(row);
    return row;
  }

  async updateStatus(id: string, status: RemittanceStatus): Promise<Remittance | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    row.status = status;
    return row;
  }

  async queryWithCursor(
    cursor: string | null,
    limit: number,
    agentId?: string,
    status?: RemittanceStatus,
    fromDate?: Date,
    toDate?: Date,
    corridor?: string,
    minAmount?: number,
    maxAmount?: number,
  ): Promise<PaginatedResult<Remittance>> {
    let items = [...this.rows];

    if (agentId) items = items.filter((r) => r.agent_id === agentId);
    if (status) items = items.filter((r) => r.status === status);
    if (fromDate) items = items.filter((r) => new Date(r.created_at) >= fromDate);
    if (toDate) items = items.filter((r) => new Date(r.created_at) <= toDate);
    if (minAmount !== undefined) items = items.filter((r) => r.amount >= minAmount!);
    if (maxAmount !== undefined) items = items.filter((r) => r.amount <= maxAmount!);
    // corridor not stored in stub — ignored

    const hasMore = items.length > limit;
    const sliced = items.slice(0, limit);
    return { items: sliced, nextCursor: hasMore ? 'next' : null, hasMore };
  }
}

function makeRow(overrides: Partial<Remittance> & { id: string }): Remittance {
  return {
    sender_id: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
    agent_id: 'GBVNNPOFVV2YNXSQXDJPBVNUAEDBBZV7YOYPNRHMCJVLQOLHQGVMKHB2',
    amount: 1000,
    fee: 25,
    status: 'Pending',
    created_at: '2026-01-15T10:00:00.000Z',
    updated_at: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('GET /api/remittances — filter params (Issue #882)', () => {
  let app: Application;
  const rows: Remittance[] = [
    makeRow({ id: 'r1', status: 'Pending', amount: 500, created_at: '2026-01-10T00:00:00.000Z', updated_at: '2026-01-10T00:00:00.000Z' }),
    makeRow({ id: 'r2', status: 'Completed', amount: 2000, created_at: '2026-02-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z' }),
    makeRow({ id: 'r3', status: 'Pending', amount: 3000, created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z' }),
  ];

  beforeAll(() => {
    app = createApp({ remittanceStore: new StubRemittanceStore(rows) });
  });

  it('returns all rows with no filters', async () => {
    const res = await request(app).get('/api/remittances?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.has_more).toBe(false);
  });

  it('filters by status=Pending', async () => {
    const res = await request(app).get('/api/remittances?status=Pending');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    res.body.data.forEach((r: Remittance) => expect(r.status).toBe('Pending'));
  });

  it('filters by status=Completed', async () => {
    const res = await request(app).get('/api/remittances?status=Completed');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('r2');
  });

  it('returns 400 for invalid status', async () => {
    const res = await request(app).get('/api/remittances?status=Unknown');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('filters by from_date', async () => {
    const res = await request(app).get('/api/remittances?from_date=2026-02-01T00:00:00.000Z');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((r: Remittance) => r.id).sort()).toEqual(['r2', 'r3'].sort());
  });

  it('filters by to_date', async () => {
    const res = await request(app).get('/api/remittances?to_date=2026-01-31T23:59:59.000Z');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('r1');
  });

  it('returns 400 for invalid from_date', async () => {
    const res = await request(app).get('/api/remittances?from_date=notadate');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DATE');
  });

  it('filters by min_amount', async () => {
    const res = await request(app).get('/api/remittances?min_amount=1000');
    expect(res.status).toBe(200);
    res.body.data.forEach((r: Remittance) => expect(r.amount).toBeGreaterThanOrEqual(1000));
  });

  it('filters by max_amount', async () => {
    const res = await request(app).get('/api/remittances?max_amount=1000');
    expect(res.status).toBe(200);
    res.body.data.forEach((r: Remittance) => expect(r.amount).toBeLessThanOrEqual(1000));
  });

  it('returns 400 when min_amount > max_amount', async () => {
    const res = await request(app).get('/api/remittances?min_amount=5000&max_amount=100');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_AMOUNT_RANGE');
  });

  it('returns 400 for negative min_amount', async () => {
    const res = await request(app).get('/api/remittances?min_amount=-1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_AMOUNT');
  });

  it('combines status + min_amount filters', async () => {
    const res = await request(app).get('/api/remittances?status=Pending&min_amount=2000');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('r3');
  });

  it('corridor param is accepted without error', async () => {
    const res = await request(app).get('/api/remittances?corridor=USD-NG');
    expect(res.status).toBe(200);
  });

  it('respects limit param', async () => {
    const res = await request(app).get('/api/remittances?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.has_more).toBe(true);
  });

  it('returns 400 for invalid limit', async () => {
    const res = await request(app).get('/api/remittances?limit=999');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_LIMIT');
  });
});
