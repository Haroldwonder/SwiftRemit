"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const database_1 = require("../database");
(0, vitest_1.describe)('FX Rate Storage', () => {
    (0, vitest_1.beforeAll)(async () => {
        await (0, database_1.initDatabase)();
    });
    (0, vitest_1.afterAll)(async () => {
        await database_1.pool.end();
    });
    (0, vitest_1.it)('should store FX rate at transaction time', async () => {
        const fxRate = {
            transaction_id: 'tx_test_001',
            rate: 1.25,
            provider: 'CurrencyAPI',
            timestamp: new Date(),
            from_currency: 'USD',
            to_currency: 'EUR',
        };
        await (0, database_1.saveFxRate)(fxRate);
        const stored = await (0, database_1.getFxRate)('tx_test_001');
        (0, vitest_1.expect)(stored).not.toBeNull();
        (0, vitest_1.expect)(stored?.rate).toBe(1.25);
        (0, vitest_1.expect)(stored?.provider).toBe('CurrencyAPI');
        (0, vitest_1.expect)(stored?.from_currency).toBe('USD');
        (0, vitest_1.expect)(stored?.to_currency).toBe('EUR');
    });
    (0, vitest_1.it)('should prevent recalculation by storing immutable rate', async () => {
        const fxRate = {
            transaction_id: 'tx_test_002',
            rate: 0.85,
            provider: 'ExchangeRateAPI',
            timestamp: new Date('2024-01-01T10:00:00Z'),
            from_currency: 'EUR',
            to_currency: 'GBP',
        };
        await (0, database_1.saveFxRate)(fxRate);
        // Try to update with different rate (should be ignored due to UNIQUE constraint)
        const updatedRate = {
            ...fxRate,
            rate: 0.90, // Different rate
            timestamp: new Date('2024-01-02T10:00:00Z'), // Different timestamp
        };
        await (0, database_1.saveFxRate)(updatedRate);
        // Verify original rate is preserved
        const stored = await (0, database_1.getFxRate)('tx_test_002');
        (0, vitest_1.expect)(stored?.rate).toBe(0.85); // Original rate preserved
        (0, vitest_1.expect)(stored?.timestamp.toISOString()).toContain('2024-01-01'); // Original timestamp
    });
    (0, vitest_1.it)('should ensure auditability with timestamp and provider', async () => {
        const timestamp = new Date('2024-06-15T14:30:00Z');
        const fxRate = {
            transaction_id: 'tx_test_003',
            rate: 110.50,
            provider: 'ForexAPI',
            timestamp,
            from_currency: 'USD',
            to_currency: 'JPY',
        };
        await (0, database_1.saveFxRate)(fxRate);
        const stored = await (0, database_1.getFxRate)('tx_test_003');
        (0, vitest_1.expect)(stored).not.toBeNull();
        (0, vitest_1.expect)(stored?.provider).toBe('ForexAPI');
        (0, vitest_1.expect)(stored?.timestamp.toISOString()).toBe(timestamp.toISOString());
        (0, vitest_1.expect)(stored?.created_at).toBeDefined(); // Audit trail
    });
    (0, vitest_1.it)('should return null for non-existent transaction', async () => {
        const stored = await (0, database_1.getFxRate)('tx_nonexistent');
        (0, vitest_1.expect)(stored).toBeNull();
    });
    (0, vitest_1.it)('should handle high precision rates', async () => {
        const fxRate = {
            transaction_id: 'tx_test_004',
            rate: 1.23456789,
            provider: 'PrecisionAPI',
            timestamp: new Date(),
            from_currency: 'BTC',
            to_currency: 'USD',
        };
        await (0, database_1.saveFxRate)(fxRate);
        const stored = await (0, database_1.getFxRate)('tx_test_004');
        (0, vitest_1.expect)(stored?.rate).toBeCloseTo(1.23456789, 8);
    });
});
