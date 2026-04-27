import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { Express, Request, Response } from 'express';
import http from 'http';
import { Pool } from 'pg';
import { Sep24Service, Sep24InitiateRequest, Sep24InteractiveResponse } from '../sep24-service';

const { sep24Rows, resetSep24Rows } = vi.hoisted(() => {
  const sep24Rows = new Map<string, Record<string, unknown>>();
  const resetSep24Rows = () => sep24Rows.clear();
  return { sep24Rows, resetSep24Rows };
});

vi.mock('../database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database')>();
  return {
    ...actual,
    getAnchorKycConfigs: vi.fn().mockResolvedValue([
      { anchor_id: 'anchor_test', kyc_server_url: 'http://localhost:0/sep24' },
    ]),
    saveSep24Transaction: vi.fn(async (record) => {
      sep24Rows.set(record.transaction_id, {
        created_at: new Date(),
        ...sep24Rows.get(record.transaction_id),
        ...record,
      });
    }),
    getSep24Transaction: vi.fn(async (transactionId: string) => sep24Rows.get(transactionId) ?? null),
    getSep24TransactionById: vi.fn(async (transactionId: string) => sep24Rows.get(transactionId) ?? null),
    getPendingSep24Transactions: vi.fn(async (anchorId: string) =>
      [...sep24Rows.values()].filter(
        (r) => r.anchor_id === anchorId && !['completed', 'refunded', 'expired', 'error'].includes(String(r.status))
      )
    ),
    updateSep24TransactionStatus: vi.fn(
      async (transactionId: string, status: string, amountIn?: string, amountOut?: string, amountFee?: string) => {
        const prev = sep24Rows.get(transactionId);
        if (!prev) return;
        sep24Rows.set(transactionId, {
          ...prev,
          status,
          amount_in: amountIn ?? prev.amount_in,
          amount_out: amountOut ?? prev.amount_out,
          amount_fee: amountFee ?? prev.amount_fee,
        });
      }
    ),
  };
});

/**
 * Mock SEP-24 Anchor Server
 * Simulates a real anchor's SEP-24 endpoints
 */
class MockSep24AnchorServer {
  private app: Express = express();
  private server: http.Server | null = null;
  private port: number = 0;
  private transactions: Map<string, { status: string; amount_in?: string; amount_out?: string }> = new Map();

  async start(): Promise<string> {
    this.app = express();
    this.app.use(express.json());

    // Mock /deposit endpoint (SEP-24)
    this.app.post('/sep24/deposit', (req: Request, res: Response) => {
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
    this.app.post('/sep24/withdraw', (req: Request, res: Response) => {
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
    this.app.get('/sep24/transaction', (req: Request, res: Response) => {
      const { id } = req.query;
      
      if (!id) {
        return res.status(400).json({ error: 'Missing transaction id' });
      }

      const transaction = this.transactions.get(id as string);
      
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
        this.port = (this.server!.address() as any).port;
        resolve(`http://localhost:${this.port}`);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // Simulate transaction completion (for testing)
  completeTransaction(transactionId: string): void {
    const txn = this.transactions.get(transactionId);
    if (txn) {
      txn.status = 'completed';
      txn.amount_out = txn.amount_in;
    }
  }

  // Simulate transaction failure (for testing)
  failTransaction(transactionId: string): void {
    const txn = this.transactions.get(transactionId);
    if (txn) {
      txn.status = 'error';
    }
  }
}

// Pool is unused by Sep24Service (database access is via imported helpers); stub for constructor
const createMockPool = (): Pool => ({}) as Pool;

describe('Sep24Service', () => {
  let mockServer: MockSep24AnchorServer;
  let serverUrl: string;
  let service: Sep24Service;
  let pool: Pool;

  beforeEach(async () => {
    mockServer = new MockSep24AnchorServer();
    serverUrl = await mockServer.start();
    
    pool = createMockPool();
    service = new Sep24Service(pool);
    
    // Mock environment for testing
    process.env.SEP24_ENABLED_ANCHOR_TEST = 'true';
    process.env.SEP24_SERVER_ANCHOR_TEST = `${serverUrl}/sep24`;
    process.env.SEP24_POLL_INTERVAL_ANCHOR_TEST = '1';
    process.env.SEP24_TIMEOUT_ANCHOR_TEST = '30';

    await service.initialize();
  });

  afterEach(async () => {
    await mockServer.stop();
    resetSep24Rows();
    vi.clearAllMocks();
  });

  describe('initiateFlow', () => {
    it('should initiate a deposit flow successfully', async () => {
      const request: Sep24InitiateRequest = {
        user_id: 'test-user-123',
        anchor_id: 'anchor_test',
        direction: 'deposit',
        asset_code: 'USDC',
        amount: '100.00',
      };

      const result = await service.initiateFlow(request);

      expect(result).toHaveProperty('transaction_id');
      expect(result).toHaveProperty('url');
      expect(result.url).toContain('/sep24/webflow');
    });

    it('should initiate a withdrawal flow successfully', async () => {
      const request: Sep24InitiateRequest = {
        user_id: 'test-user-123',
        anchor_id: 'anchor_test',
        direction: 'withdrawal',
        asset_code: 'USDC',
        amount: '50.00',
        user_address: 'GAXXX',
      };

      const result = await service.initiateFlow(request);

      expect(result).toHaveProperty('transaction_id');
      expect(result).toHaveProperty('url');
    });

    it('should throw Sep24ConfigError for unknown anchor', async () => {
      const request: Sep24InitiateRequest = {
        user_id: 'test-user-123',
        anchor_id: 'unknown-anchor',
        direction: 'deposit',
        asset_code: 'USDC',
        amount: '100.00',
      };

      await expect(service.initiateFlow(request)).rejects.toThrow();
    });
  });

  describe('pollAllTransactions', () => {
    it('should poll pending transactions', async () => {
      // First initiate a transaction
      const request: Sep24InitiateRequest = {
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

  describe('anchor timeout (pending_anchor)', () => {
    it('transitions pending_anchor transaction to error after timeout and increments counter', async () => {
      // Set a very short timeout (0 hours) so any transaction is immediately stale
      process.env.ANCHOR_TIMEOUT_HOURS = '0';
      const timeoutService = new Sep24Service(pool);
      await timeoutService.initialize();

      const request: Sep24InitiateRequest = {
        user_id: 'timeout-user',
        anchor_id: 'anchor_test',
        direction: 'deposit',
        asset_code: 'USDC',
        amount: '50.00',
      };

      const result = await timeoutService.initiateFlow(request);

      // Confirm it starts as pending_anchor
      const before = await timeoutService.getTransactionStatus(result.transaction_id);
      expect(before?.status).toBe('pending_anchor');

      // Poll — should detect timeout and mark as error
      await timeoutService.pollAllTransactions();

      const after = await timeoutService.getTransactionStatus(result.transaction_id);
      expect(after?.status).toBe('error');
      expect(timeoutService.getStalledTransactionsTotal()).toBe(1);

      // Restore default
      process.env.ANCHOR_TIMEOUT_HOURS = '24';
    });
  });

  describe('getTransactionStatus', () => {
    it('should return transaction status', async () => {
      const request: Sep24InitiateRequest = {
        user_id: 'test-user-123',
        anchor_id: 'anchor_test',
        direction: 'deposit',
        asset_code: 'USDC',
        amount: '100.00',
      };

      const result = await service.initiateFlow(request);
      const status = await service.getTransactionStatus(result.transaction_id);

      expect(status).not.toBeNull();
      expect(status?.transaction_id).toBe(result.transaction_id);
      expect(status?.status).toBeDefined();
    });

    it('should return null for unknown transaction', async () => {
      const status = await service.getTransactionStatus('unknown-txn-id');
      expect(status).toBeNull();
    });
  });

  describe('handleWebhookNotification', () => {
    it('should handle completion webhook', async () => {
      const request: Sep24InitiateRequest = {
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
      expect(status?.status).toBe('completed');
    });

    it('should handle error webhook', async () => {
      const request: Sep24InitiateRequest = {
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
      expect(status?.status).toBe('error');
    });
  });
});

describe('Error Handling', () => {
  let mockServer: MockSep24AnchorServer;
  let serverUrl: string;
  let pool: Pool;

  beforeEach(async () => {
    mockServer = new MockSep24AnchorServer();
    serverUrl = await mockServer.start();
    pool = createMockPool();
    
    process.env.SEP24_ENABLED_ANCHOR_TEST = 'true';
    process.env.SEP24_SERVER_ANCHOR_TEST = serverUrl + '/sep24';
    process.env.SEP24_POLL_INTERVAL_ANCHOR_TEST = '1';
    process.env.SEP24_TIMEOUT_ANCHOR_TEST = '30';
    resetSep24Rows();
  });

  afterEach(async () => {
    await mockServer.stop();
  });

  it('should handle anchor connection error', async () => {
    process.env.SEP24_SERVER_ANCHOR_TEST = 'http://localhost:9999/nonexistent';
    
    const service = new Sep24Service(pool);
    await service.initialize();
    
    const request: Sep24InitiateRequest = {
      user_id: 'test-user-123',
      anchor_id: 'anchor_test',
      direction: 'deposit',
      asset_code: 'USDC',
      amount: '100.00',
    };

    await expect(service.initiateFlow(request)).rejects.toThrow();
  });
});