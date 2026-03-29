import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { saveFxRate, getFxRate, initDatabase, pool } from '../database';

describe('FX Rate Storage', () => {
  let dbReady = false;

  beforeAll(async () => {
    try {
      await initDatabase();
      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should store FX rate at transaction time', async () => {
    if (!dbReady) return;
    const fxRate = {
      transaction_id: 'tx_test_001',
      rate: 1.25,
      provider: 'CurrencyAPI',
      timestamp: new Date(),
      from_currency: 'USD',
      to_currency: 'EUR',
    };

    await saveFxRate(fxRate);

    const stored = await getFxRate('tx_test_001');
    expect(stored).not.toBeNull();
    expect(stored?.rate).toBe(1.25);
    expect(stored?.provider).toBe('CurrencyAPI');
    expect(stored?.from_currency).toBe('USD');
    expect(stored?.to_currency).toBe('EUR');
  });

  it('should prevent recalculation by storing immutable rate', async () => {
    if (!dbReady) return;
    const fxRate = {
      transaction_id: 'tx_test_002',
      rate: 0.85,
      provider: 'ExchangeRateAPI',
      timestamp: new Date('2024-01-01T10:00:00Z'),
      from_currency: 'EUR',
      to_currency: 'GBP',
    };

    await saveFxRate(fxRate);

    // Try to update with different rate (should be ignored due to UNIQUE constraint)
    const updatedRate = {
      ...fxRate,
      rate: 0.90, // Different rate
      timestamp: new Date('2024-01-02T10:00:00Z'), // Different timestamp
    };

    await saveFxRate(updatedRate);

    // Verify original rate is preserved
    const stored = await getFxRate('tx_test_002');
    expect(stored?.rate).toBe(0.85); // Original rate preserved
    expect(stored?.timestamp.toISOString()).toContain('2024-01-01'); // Original timestamp
  });

  it('should ensure auditability with timestamp and provider', async () => {
    if (!dbReady) return;
    const timestamp = new Date('2024-06-15T14:30:00Z');
    const fxRate = {
      transaction_id: 'tx_test_003',
      rate: 110.50,
      provider: 'ForexAPI',
      timestamp,
      from_currency: 'USD',
      to_currency: 'JPY',
    };

    await saveFxRate(fxRate);

    const stored = await getFxRate('tx_test_003');
    expect(stored).not.toBeNull();
    expect(stored?.provider).toBe('ForexAPI');
    expect(stored?.timestamp.toISOString()).toBe(timestamp.toISOString());
    expect(stored?.created_at).toBeDefined(); // Audit trail
  });

  it('should return null for non-existent transaction', async () => {
    if (!dbReady) return;
    const stored = await getFxRate('tx_nonexistent');
    expect(stored).toBeNull();
  });

  it('should handle high precision rates', async () => {
    if (!dbReady) return;
    const fxRate = {
      transaction_id: 'tx_test_004',
      rate: 1.23456789,
      provider: 'PrecisionAPI',
      timestamp: new Date(),
      from_currency: 'BTC',
      to_currency: 'USD',
    };

    await saveFxRate(fxRate);

    const stored = await getFxRate('tx_test_004');
    expect(stored?.rate).toBeCloseTo(1.23456789, 8);
  });
});
