"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const express_1 = __importDefault(require("express"));
const pg_1 = require("pg");
const sep24_service_1 = require("../sep24-service");
/**
 * Mock SEP-24 Anchor Server
 * Simulates a real anchor's SEP-24 endpoints
 */
class MockSep24AnchorServer {
    app = (0, express_1.default)();
    server = null;
    port = 0;
    transactions = new Map();
    async start() {
        this.app = (0, express_1.default)();
        this.app.use(express_1.default.json());
        // Mock /deposit endpoint (SEP-24)
        this.app.post('/sep24/deposit', (req, res) => {
            const { transaction_id, asset_code, amount } = req.body;
            if (!transaction_id || !asset_code || !amount) {
                return res.status(400).json({ error: 'Missing required fields' });
            }
            // Store transaction
            this.transactions.set(transaction_id, {
                status: 'pending_anchor',
                amount_in: amount,
            });
            // Return interactive response
            res.json({
                transaction_id,
                url: `http://localhost:${this.port}/sep24/webflow?transaction_id=${transaction_id}`,
                interactive_url: `http://localhost:${this.port}/sep24/webflow?transaction_id=${transaction_id}`,
                instructions_url: `http://localhost:${this.port}/sep24/instructions?transaction_id=${transaction_id}`,
            });
        });
        // Mock /withdraw endpoint (SEP-24)
        this.app.post('/sep24/withdraw', (req, res) => {
            const { transaction_id, asset_code, amount } = req.body;
            if (!transaction_id || !asset_code || !amount) {
                return res.status(400).json({ error: 'Missing required fields' });
            }
            this.transactions.set(transaction_id, {
                status: 'pending_anchor',
                amount_in: amount,
            });
            res.json({
                transaction_id,
                url: `http://localhost:${this.port}/sep24/webflow?transaction_id=${transaction_id}`,
                interactive_url: `http://localhost:${this.port}/sep24/webflow?transaction_id=${transaction_id}`,
            });
        });
        // Mock /transaction endpoint (SEP-24 status query)
        this.app.get('/sep24/transaction', (req, res) => {
            const { id } = req.query;
            if (!id) {
                return res.status(400).json({ error: 'Missing transaction id' });
            }
            const transaction = this.transactions.get(id);
            if (!transaction) {
                return res.status(404).json({ error: 'Transaction not found' });
            }
            res.json({
                transaction: {
                    id,
                    status: transaction.status,
                    amount_in: transaction.amount_in,
                    amount_out: transaction.amount_out,
                    amount_fee: '0',
                    stellar_transaction_id: null,
                    external_transaction_id: null,
                    message: 'Transaction in progress',
                },
            });
        });
        return new Promise((resolve) => {
            this.server = this.app.listen(0, () => {
                this.port = this.server.address().port;
                resolve(`http://localhost:${this.port}`);
            });
        });
    }
    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => resolve());
            }
            else {
                resolve();
            }
        });
    }
    // Simulate transaction completion (for testing)
    completeTransaction(transactionId) {
        const txn = this.transactions.get(transactionId);
        if (txn) {
            txn.status = 'completed';
            txn.amount_out = txn.amount_in;
        }
    }
    // Simulate transaction failure (for testing)
    failTransaction(transactionId) {
        const txn = this.transactions.get(transactionId);
        if (txn) {
            txn.status = 'error';
        }
    }
}
// Mock pool for testing
const createMockPool = () => {
    // In-memory mock - in real tests, use testcontainers or mocked pg
    return new pg_1.Pool({
        connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/swiftremit_test',
    });
};
(0, vitest_1.describe)('Sep24Service', () => {
    let mockServer;
    let serverUrl;
    let service;
    let pool;
    (0, vitest_1.beforeEach)(async () => {
        mockServer = new MockSep24AnchorServer();
        serverUrl = await mockServer.start();
        pool = createMockPool();
        service = new sep24_service_1.Sep24Service(pool);
        // Mock environment for testing
        process.env.SEP24_ENABLED_ANCHOR_TEST = 'true';
        process.env.SEP24_SERVER_ANCHOR_TEST = serverUrl.replace(':3000', `:${parseInt(serverUrl.split(':')[2])}`) + '/sep24';
        process.env.SEP24_POLL_INTERVAL_ANCHOR_TEST = '1';
        process.env.SEP24_TIMEOUT_ANCHOR_TEST = '30';
    });
    (0, vitest_1.afterEach)(async () => {
        await mockServer.stop();
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.describe)('initiateFlow', () => {
        (0, vitest_1.it)('should initiate a deposit flow successfully', async () => {
            const request = {
                user_id: 'test-user-123',
                anchor_id: 'anchor_test',
                direction: 'deposit',
                asset_code: 'USDC',
                amount: '100.00',
            };
            const result = await service.initiateFlow(request);
            (0, vitest_1.expect)(result).toHaveProperty('transaction_id');
            (0, vitest_1.expect)(result).toHaveProperty('url');
            (0, vitest_1.expect)(result.url).toContain('/sep24/webflow');
        });
        (0, vitest_1.it)('should initiate a withdrawal flow successfully', async () => {
            const request = {
                user_id: 'test-user-123',
                anchor_id: 'anchor_test',
                direction: 'withdrawal',
                asset_code: 'USDC',
                amount: '50.00',
                user_address: 'GAXXX',
            };
            const result = await service.initiateFlow(request);
            (0, vitest_1.expect)(result).toHaveProperty('transaction_id');
            (0, vitest_1.expect)(result).toHaveProperty('url');
        });
        (0, vitest_1.it)('should throw Sep24ConfigError for unknown anchor', async () => {
            const request = {
                user_id: 'test-user-123',
                anchor_id: 'unknown-anchor',
                direction: 'deposit',
                asset_code: 'USDC',
                amount: '100.00',
            };
            await (0, vitest_1.expect)(service.initiateFlow(request)).rejects.toThrow();
        });
    });
    (0, vitest_1.describe)('pollAllTransactions', () => {
        (0, vitest_1.it)('should poll pending transactions', async () => {
            // First initiate a transaction
            const request = {
                user_id: 'test-user-123',
                anchor_id: 'anchor_test',
                direction: 'deposit',
                asset_code: 'USDC',
                amount: '100.00',
            };
            const result = await service.initiateFlow(request);
            // Manually set last_polled to trigger polling
            // (In real test, would need to wait or modify DB)
            // Poll - should not throw
            await service.pollAllTransactions();
        });
    });
    (0, vitest_1.describe)('getTransactionStatus', () => {
        (0, vitest_1.it)('should return transaction status', async () => {
            const request = {
                user_id: 'test-user-123',
                anchor_id: 'anchor_test',
                direction: 'deposit',
                asset_code: 'USDC',
                amount: '100.00',
            };
            const result = await service.initiateFlow(request);
            const status = await service.getTransactionStatus(result.transaction_id);
            (0, vitest_1.expect)(status).not.toBeNull();
            (0, vitest_1.expect)(status?.transaction_id).toBe(result.transaction_id);
            (0, vitest_1.expect)(status?.status).toBeDefined();
        });
        (0, vitest_1.it)('should return null for unknown transaction', async () => {
            const status = await service.getTransactionStatus('unknown-txn-id');
            (0, vitest_1.expect)(status).toBeNull();
        });
    });
    (0, vitest_1.describe)('handleWebhookNotification', () => {
        (0, vitest_1.it)('should handle completion webhook', async () => {
            const request = {
                user_id: 'test-user-123',
                anchor_id: 'anchor_test',
                direction: 'deposit',
                asset_code: 'USDC',
                amount: '100.00',
            };
            const result = await service.initiateFlow(request);
            // Simulate webhook
            await service.handleWebhookNotification({
                transaction_id: result.transaction_id,
                status: 'completed',
                amount_in: '100.00',
                amount_out: '99.00',
                amount_fee: '1.00',
            });
            const status = await service.getTransactionStatus(result.transaction_id);
            (0, vitest_1.expect)(status?.status).toBe('completed');
        });
        (0, vitest_1.it)('should handle error webhook', async () => {
            const request = {
                user_id: 'test-user-123',
                anchor_id: 'anchor_test',
                direction: 'deposit',
                asset_code: 'USDC',
                amount: '100.00',
            };
            const result = await service.initiateFlow(request);
            // Simulate error webhook
            await service.handleWebhookNotification({
                transaction_id: result.transaction_id,
                status: 'error',
                message: 'Transaction failed',
            });
            const status = await service.getTransactionStatus(result.transaction_id);
            (0, vitest_1.expect)(status?.status).toBe('error');
        });
    });
});
(0, vitest_1.describe)('Error Handling', () => {
    let mockServer;
    let serverUrl;
    let pool;
    (0, vitest_1.beforeEach)(async () => {
        mockServer = new MockSep24AnchorServer();
        serverUrl = await mockServer.start();
        pool = createMockPool();
        process.env.SEP24_ENABLED_ANCHOR_TEST = 'true';
        process.env.SEP24_SERVER_ANCHOR_TEST = serverUrl + '/sep24';
    });
    (0, vitest_1.afterEach)(async () => {
        await mockServer.stop();
    });
    (0, vitest_1.it)('should handle anchor timeout', async () => {
        const service = new sep24_service_1.Sep24Service(pool);
        // Set very short timeout
        process.env.SEP24_TIMEOUT_ANCHOR_TEST = '1';
        // This would timeout in a real scenario
        const request = {
            user_id: 'test-user-123',
            anchor_id: 'anchor_test',
            direction: 'deposit',
            asset_code: 'USDC',
            amount: '100.00',
        };
        // Should throw error or handle timeout
        await (0, vitest_1.expect)(service.initiateFlow(request)).rejects.toThrow();
    });
    (0, vitest_1.it)('should handle anchor connection error', async () => {
        process.env.SEP24_SERVER_ANCHOR_TEST = 'http://localhost:9999/nonexistent';
        const service = new sep24_service_1.Sep24Service(pool);
        const request = {
            user_id: 'test-user-123',
            anchor_id: 'anchor_test',
            direction: 'deposit',
            asset_code: 'USDC',
            amount: '100.00',
        };
        await (0, vitest_1.expect)(service.initiateFlow(request)).rejects.toThrow();
    });
});
