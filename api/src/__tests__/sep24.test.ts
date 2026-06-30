import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { Sep24Client, Sep24Transaction } from '../services/sep24';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const CLIENT_CONFIG = {
  anchorBaseUrl: 'https://testanchor.stellar.org',
  jwtToken: 'test-jwt-token',
};

function makeTx(overrides: Partial<Sep24Transaction> = {}): Sep24Transaction {
  return {
    id: 'sep24-tx-001',
    kind: 'deposit',
    status: 'completed',
    startedAt: '2024-06-01T10:00:00Z',
    completedAt: '2024-06-01T10:05:00Z',
    amountIn: '100.00',
    amountOut: '97.50',
    amountFee: '2.50',
    stellarTransactionId: 'stellar-tx-hash-abc',
    ...overrides,
  };
}

describe('Sep24Client', () => {
  let client: Sep24Client;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    client = new Sep24Client(CLIENT_CONFIG);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initiateDeposit', () => {
    it('returns interactive URL on success', async () => {
      const mockResponse = {
        data: {
          type: 'interactive_customer_info_needed',
          url: 'https://testanchor.stellar.org/sep24/transactions/deposit/webapp?token=abc',
          id: 'sep24-tx-001',
        },
      };
      mockedAxios.post = vi.fn().mockResolvedValueOnce(mockResponse);

      const result = await client.initiateDeposit({
        assetCode: 'USDC',
        assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        account: 'GABC1234DEF5678',
        amount: '100.00',
      });

      expect(result.type).toBe('interactive_customer_info_needed');
      expect(result.url).toContain('sep24/transactions/deposit/webapp');
      expect(result.id).toBe('sep24-tx-001');
    });

    it('throws if response type is unexpected', async () => {
      mockedAxios.post = vi.fn().mockResolvedValueOnce({
        data: { type: 'error', error: 'KYC required' },
      });

      await expect(
        client.initiateDeposit({
          assetCode: 'USDC',
          assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          account: 'GABC1234DEF5678',
        }),
      ).rejects.toThrow('Unexpected response type');
    });

    it('sends Authorization header', async () => {
      mockedAxios.post = vi.fn().mockResolvedValueOnce({
        data: {
          type: 'interactive_customer_info_needed',
          url: 'http://anchor/interactive',
          id: 'tx-1',
        },
      });

      await client.initiateDeposit({
        assetCode: 'USDC',
        assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        account: 'GABC1234',
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('sep24/transactions/deposit/interactive'),
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-jwt-token',
          }),
        }),
      );
    });
  });

  describe('getTransaction', () => {
    it('returns transaction data', async () => {
      const tx = makeTx();
      mockedAxios.get = vi.fn().mockResolvedValueOnce({ data: { transaction: tx } });

      const result = await client.getTransaction('sep24-tx-001');
      expect(result.id).toBe('sep24-tx-001');
      expect(result.status).toBe('completed');
    });
  });

  describe('pollUntilComplete', () => {
    it('resolves immediately when tx is already completed', async () => {
      const tx = makeTx({ status: 'completed' });
      mockedAxios.get = vi.fn().mockResolvedValueOnce({ data: { transaction: tx } });

      const promise = client.pollUntilComplete('sep24-tx-001', { intervalMs: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.status).toBe('completed');
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('polls until completed', async () => {
      const pending = makeTx({ status: 'pending_anchor' });
      const done = makeTx({ status: 'completed' });
      mockedAxios.get = vi
        .fn()
        .mockResolvedValueOnce({ data: { transaction: pending } })
        .mockResolvedValueOnce({ data: { transaction: pending } })
        .mockResolvedValueOnce({ data: { transaction: done } });

      const promise = client.pollUntilComplete('sep24-tx-001', {
        intervalMs: 100,
        timeoutMs: 10_000,
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.status).toBe('completed');
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });

    it('resolves with expired status on expiry', async () => {
      const expiredTx = makeTx({ status: 'expired' });
      mockedAxios.get = vi.fn().mockResolvedValueOnce({ data: { transaction: expiredTx } });

      const promise = client.pollUntilComplete('sep24-tx-001', { intervalMs: 50 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.status).toBe('expired');
    });

    it('resolves with refunded status on refund path', async () => {
      const refunded = makeTx({
        status: 'refunded',
        refunds: {
          amountRefunded: '100.00',
          amountFee: '0.00',
          payments: [],
        },
      });
      mockedAxios.get = vi.fn().mockResolvedValueOnce({ data: { transaction: refunded } });

      const promise = client.pollUntilComplete('sep24-tx-001', { intervalMs: 50 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.status).toBe('refunded');
    });

    it('throws timeout when polling exceeds deadline', async () => {
      const pending = makeTx({ status: 'pending_anchor' });
      mockedAxios.get = vi.fn().mockResolvedValue({ data: { transaction: pending } });

      const promise = client.pollUntilComplete('sep24-tx-001', {
        intervalMs: 200,
        timeoutMs: 500,
      });
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('SEP-24 poll timeout');
    });
  });
});
