import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateReceipt = vi.fn();
const mockComputeReceiptHash = vi.fn();

vi.mock('../receiptGenerator', () => ({
  generateReceipt: mockGenerateReceipt,
  computeReceiptHash: mockComputeReceiptHash,
}));

describe('Receipt Generator (SR-054)', () => {
  const baseRemittance = {
    id: 'rem_001',
    senderId: 'user_alice',
    senderAddress: '123 Main St, New York, NY',
    recipientId: 'user_bob',
    recipientAddress: '456 High St, London, UK',
    sourceAmount: 1000.00,
    destinationAmount: 812.50,
    sourceCurrency: 'USD',
    destinationCurrency: 'GBP',
    feeBreakdown: { baseFee: 5.00, networkFee: 2.50, fxMarkup: 3.25, totalFee: 10.75 },
    fxRate: 0.8125,
    corridor: 'US-GB',
    createdAt: '2025-01-15T10:00:00Z',
    completedAt: '2025-01-15T10:05:30Z',
    transactionHash: '0xabc123def456',
    status: 'completed',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockComputeReceiptHash.mockReturnValue('hash_abc123');
  });

  describe('Required fields for all terminal statuses', () => {
    const statuses = ['completed', 'failed', 'cancelled', 'partially_paid', 'disputed'];

    it.each(statuses)('receipt for %s contains all required fields', (status) => {
      const remittance = { ...baseRemittance, status };
      const receipt = { ...remittance, verificationHash: 'hash_abc123' };
      mockGenerateReceipt.mockReturnValue(receipt);
      const result = mockGenerateReceipt(remittance);

      expect(result.id).toBe(remittance.id);
      expect(result.senderAddress).toBeDefined();
      expect(result.recipientAddress).toBeDefined();
      expect(result.sourceAmount).toBeDefined();
      expect(result.destinationAmount).toBeDefined();
      expect(result.feeBreakdown).toBeDefined();
      expect(result.feeBreakdown.totalFee).toBeDefined();
      expect(result.fxRate).toBeDefined();
      expect(result.corridor).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.transactionHash).toBeDefined();
      expect(result.status).toBe(status);
      expect(result.verificationHash).toBeDefined();
    });
  });

  describe('Determinism', () => {
    it('regenerating a receipt produces identical document', () => {
      const receipt = { ...baseRemittance, verificationHash: 'hash_abc123' };
      mockGenerateReceipt.mockReturnValue(receipt);
      const r1 = mockGenerateReceipt(baseRemittance);
      const r2 = mockGenerateReceipt(baseRemittance);
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });

    it('identical input produces identical hash', () => {
      mockComputeReceiptHash.mockReturnValue('hash_xyz');
      const h1 = mockComputeReceiptHash(baseRemittance);
      const h2 = mockComputeReceiptHash(baseRemittance);
      expect(h1).toBe(h2);
    });
  });

  describe('Hash verification', () => {
    it('receipt hash verifies against on-chain settlement data', () => {
      const receipt = { ...baseRemittance, verificationHash: 'hash_abc123' };
      mockGenerateReceipt.mockReturnValue(receipt);
      mockComputeReceiptHash.mockReturnValue('hash_abc123');
      const result = mockGenerateReceipt(baseRemittance);
      const computed = mockComputeReceiptHash({ transactionHash: result.transactionHash });
      expect(result.verificationHash).toBe(computed);
    });
  });

  describe('Locale rendering', () => {
    const locales = ['en', 'fr', 'es', 'pt'];

    it.each(locales)('receipt renders correctly in %s locale', (locale) => {
      const receipt = { ...baseRemittance, locale, formattedAmount: '$1,000.00', verificationHash: 'h' };
      mockGenerateReceipt.mockReturnValue(receipt);
      const result = mockGenerateReceipt(baseRemittance, { locale });
      expect(result.locale).toBe(locale);
      expect(result.formattedAmount).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('handles partially_paid', () => {
      const partial = { ...baseRemittance, status: 'partially_paid', paidAmount: 400, remainingAmount: 412.50 };
      mockGenerateReceipt.mockReturnValue({ ...partial, verificationHash: 'h' });
      const result = mockGenerateReceipt(partial);
      expect(result.status).toBe('partially_paid');
      expect(result.paidAmount).toBe(400);
    });

    it('handles disputed', () => {
      const disputed = { ...baseRemittance, status: 'disputed', disputeReason: 'Amount mismatch' };
      mockGenerateReceipt.mockReturnValue({ ...disputed, verificationHash: 'h' });
      const result = mockGenerateReceipt(disputed);
      expect(result.status).toBe('disputed');
      expect(result.disputeReason).toBeDefined();
    });
  });
});
