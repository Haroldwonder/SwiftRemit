import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { Express, Request, Response } from 'express';
import http from 'http';
import { Pool } from 'pg';
import { Sep24Service, Sep24InitiateRequest, Sep24InteractiveResponse } from '../sep24-service';

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

// Mock pool for testing
const createMockPool = (): Pool => {
  // In-memory mock - in real tests, use testcontainers or mocked pg
  return new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/swiftremit_test',
  });
};

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
    process.env.SEP24_SERVER_ANCHOR_TEST = serverUrl.replace(':3000', `:${parseInt(serverUrl.split(':')[2])}`) + '/sep24';
    process.env.SEP24_POLL_INTERVAL_ANCHOR_TEST = '1';
    process.env.SEP24_TIMEOUT_ANCHOR_TEST = '30';
  });

  afterEach(async () => {
    await mockServer.stop();
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
  });

  afterEach(async () => {
    await mockServer.stop();
  });

  it('should handle anchor timeout', async () => {
    const service = new Sep24Service(pool);
    
    // Set very short timeout
    process.env.SEP24_TIMEOUT_ANCHOR_TEST = '1';
    
    // This would timeout in a real scenario
    const request: Sep24InitiateRequest = {
      user_id: 'test-user-123',
      anchor_id: 'anchor_test',
      direction: 'deposit',
      asset_code: 'USDC',
      amount: '100.00',
    };

    // Should throw error or handle timeout
    await expect(service.initiateFlow(request)).rejects.toThrow();
  });

  it('should handle anchor connection error', async () => {
    process.env.SEP24_SERVER_ANCHOR_TEST = 'http://localhost:9999/nonexistent';
    
    const service = new Sep24Service(pool);
    
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