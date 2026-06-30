/**
 * Tests for POST /api/settlements/simulate (Issue #420)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { Application } from 'express';
import { computeNetSettlements, SimulateRemittanceInput } from '../routes/settlements';

describe('POST /api/settlements/simulate', () => {
  let app: Application;

  beforeAll(() => {
    app = createApp();
  });

  it('returns 400 when remittances is missing', async () => {
    const res = await request(app).post('/api/settlements/simulate').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when remittances is not an array', async () => {
    const res = await request(app)
      .post('/api/settlements/simulate')
      .send({ remittances: 'bad' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a remittance entry is malformed', async () => {
    const res = await request(app)
      .post('/api/settlements/simulate')
      .send({ remittances: [{ id: 1 }] }); // missing required fields
    expect(res.status).toBe(400);
  });

  it('returns empty net_transfers for an empty input', async () => {
    const res = await request(app)
      .post('/api/settlements/simulate')
      .send({ remittances: [] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.net_transfers).toHaveLength(0);
    expect(res.body.data.summary.input_count).toBe(0);
  });

  it('computes a simple net transfer between two parties', async () => {
    const remittances: SimulateRemittanceInput[] = [
      { id: 1, sender: 'AAAA', agent: 'BBBB', amount: 100, fee: 2, status: 'Pending' },
      { id: 2, sender: 'BBBB', agent: 'AAAA', amount: 90, fee: 1, status: 'Pending' },
    ];
    const res = await request(app)
      .post('/api/settlements/simulate')
      .send({ remittances });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const transfers = res.body.data.net_transfers;
    expect(transfers).toHaveLength(1);
    expect(Math.abs(transfers[0].net_amount)).toBe(10);
    expect(transfers[0].total_fees).toBe(3);
  });

  it('produces no transfer when net position is zero (Issue #421 parity)', async () => {
    const remittances: SimulateRemittanceInput[] = [
      { id: 1, sender: 'AAAA', agent: 'BBBB', amount: 100, fee: 2, status: 'Pending' },
      { id: 2, sender: 'BBBB', agent: 'AAAA', amount: 100, fee: 2, status: 'Pending' },
    ];
    const res = await request(app)
      .post('/api/settlements/simulate')
      .send({ remittances });

    expect(res.status).toBe(200);
    expect(res.body.data.net_transfers).toHaveLength(0);
  });

  it('ignores non-Pending remittances', async () => {
    const remittances: SimulateRemittanceInput[] = [
      { id: 1, sender: 'AAAA', agent: 'BBBB', amount: 100, fee: 2, status: 'Completed' },
      { id: 2, sender: 'CCCC', agent: 'DDDD', amount: 50, fee: 1, status: 'Pending' },
    ];
    const res = await request(app)
      .post('/api/settlements/simulate')
      .send({ remittances });

    expect(res.status).toBe(200);
    const transfers = res.body.data.net_transfers;
    // Only the Pending one should appear
    expect(transfers).toHaveLength(1);
    expect(transfers[0].party_a).toBe('CCCC');
  });

  it('summary totals are correct', async () => {
    const remittances: SimulateRemittanceInput[] = [
      { id: 1, sender: 'AAAA', agent: 'BBBB', amount: 200, fee: 4, status: 'Pending' },
      { id: 2, sender: 'CCCC', agent: 'DDDD', amount: 100, fee: 2, status: 'Pending' },
    ];
    const res = await request(app)
      .post('/api/settlements/simulate')
      .send({ remittances });

    expect(res.status).toBe(200);
    expect(res.body.data.summary.input_count).toBe(2);
    expect(res.body.data.summary.total_gross_amount).toBe(300);
  });
});

// ── Unit tests for the pure computeNetSettlements helper ──────────────────────

describe('computeNetSettlements (unit)', () => {
  it('handles empty input', () => {
    expect(computeNetSettlements([])).toHaveLength(0);
  });

  it('nets opposing flows correctly', () => {
    const inputs: SimulateRemittanceInput[] = [
      { id: 1, sender: 'A', agent: 'B', amount: 100, fee: 2, status: 'Pending' },
      { id: 2, sender: 'B', agent: 'A', amount: 60, fee: 1, status: 'Pending' },
    ];
    const result = computeNetSettlements(inputs);
    expect(result).toHaveLength(1);
    expect(Math.abs(result[0].net_amount)).toBe(40);
    expect(result[0].total_fees).toBe(3);
  });

  it('skips zero-net positions', () => {
    const inputs: SimulateRemittanceInput[] = [
      { id: 1, sender: 'A', agent: 'B', amount: 50, fee: 1, status: 'Pending' },
      { id: 2, sender: 'B', agent: 'A', amount: 50, fee: 1, status: 'Pending' },
    ];
    expect(computeNetSettlements(inputs)).toHaveLength(0);
  });
});
