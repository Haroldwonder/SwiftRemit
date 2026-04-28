import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HorizonService } from '../horizonService';

// Mock the Stellar SDK
vi.mock('@stellar/stellar-sdk', () => {
  const mockEventsCall = vi.fn();
  
  return {
    Server: vi.fn().mockImplementation(() => ({
      events: () => ({
        forContract: () => ({
          limit: () => ({
            order: () => ({
              call: mockEventsCall,
            }),
          }),
        }),
      }),
    })),
    Horizon: {},
  };
});

describe('HorizonService', () => {
  let horizonService: HorizonService;
  let mockServer: any;

  beforeEach(() => {
    vi.clearAllMocks();
    horizonService = new HorizonService('https://soroban-testnet.stellar.org', 'test-contract-id');
    mockServer = (horizonService as any).server;
  });

  describe('fetchCompletedEvent', () => {
    it('should fetch and parse settlement completed event successfully', async () => {
      const mockEventData = {
        records: [
          {
            topic: [
              { _value: { _value: 'settle' } },
              { _value: { _value: 'complete' } },
            ],
            value: {
              _value: [
                { _value: { _value: '1' } }, // schema version
                { _value: { _value: '12345' } }, // ledger sequence
                { _value: { _value: '1234567890' } }, // timestamp
                { _value: { _value: '42' } }, // remittance_id
                { _value: { _value: 'SENDER_ADDRESS_123' } }, // sender
                { _value: { _value: 'AGENT_ADDRESS_456' } }, // agent
                { _value: { _value: 'ASSET_ADDRESS_789' } }, // asset
                { _value: { _value: '10000000' } }, // amount (1 USDC in stroops)
              ],
            },
            txHash: 'abc123def456',
            ledger: 12345,
            ledgerClosedAt: '2024-01-01T00:00:00Z',
          },
        ],
      };

      // Mock the events call
      mockServer.events = vi.fn().mockReturnValue({
        forContract: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              call: vi.fn()
                .mockResolvedValueOnce(mockEventData) // First call for settlement event
                .mockResolvedValueOnce({ // Second call for fee lookup
                  records: [
                    {
                      topic: [
                        { _value: { _value: 'remit' } },
                        { _value: { _value: 'created' } },
                      ],
                      value: {
                        _value: [
                          { _value: { _value: '1' } },
                          { _value: { _value: '12345' } },
                          { _value: { _value: '1234567890' } },
                          { _value: { _value: '42' } }, // remittance_id
                          { _value: { _value: 'SENDER' } },
                          { _value: { _value: 'AGENT' } },
                          { _value: { _value: '10000000' } },
                          { _value: { _value: '50000' } }, // fee
                        ],
                      },
                    },
                  ],
                }),
            }),
          }),
        }),
      });

      const result = await horizonService.fetchCompletedEvent(42);

      expect(result).not.toBeNull();
      expect(result?.remittanceId).toBe('42');
      expect(result?.sender).toBe('SENDER_ADDRESS_123');
      expect(result?.agent).toBe('AGENT_ADDRESS_456');
      expect(result?.amount).toBe('10000000');
      expect(result?.fee).toBe('50000');
      expect(result?.transactionHash).toBe('abc123def456');
    });

    it('should return null when no matching event is found', async () => {
      mockServer.events = vi.fn().mockReturnValue({
        forContract: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              call: vi.fn().mockResolvedValue({ records: [] }),
            }),
          }),
        }),
      });

      const result = await horizonService.fetchCompletedEvent(999);

      expect(result).toBeNull();
    });

    it('should throw error when contract ID is not configured', async () => {
      const serviceWithoutContract = new HorizonService('https://soroban-testnet.stellar.org', '');

      await expect(serviceWithoutContract.fetchCompletedEvent(42)).rejects.toThrow(
        'Contract ID not configured'
      );
    });

    it('should handle API errors gracefully', async () => {
      mockServer.events = vi.fn().mockReturnValue({
        forContract: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              call: vi.fn().mockRejectedValue(new Error('Network error')),
            }),
          }),
        }),
      });

      await expect(horizonService.fetchCompletedEvent(42)).rejects.toThrow(
        'Failed to fetch completed event: Network error'
      );
    });
  });

  describe('getStellarExpertLink', () => {
    it('should generate correct testnet link', () => {
      const link = horizonService.getStellarExpertLink('abc123', 'testnet');
      expect(link).toBe('https://stellar.expert/explorer/testnet/tx/abc123');
    });

    it('should generate correct public network link', () => {
      const link = horizonService.getStellarExpertLink('abc123', 'public');
      expect(link).toBe('https://stellar.expert/explorer/public/tx/abc123');
    });

    it('should default to testnet when network is not specified', () => {
      const link = horizonService.getStellarExpertLink('abc123');
      expect(link).toBe('https://stellar.expert/explorer/testnet/tx/abc123');
    });
  });
});
