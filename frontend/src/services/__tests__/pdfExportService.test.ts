import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePDF, generateBulkPDF } from '../pdfExportService';
import type { TransactionHistoryItem } from '../../components/TransactionHistory';

vi.mock('jspdf');

describe('pdfExportService', () => {
  const mockTransaction: TransactionHistoryItem = {
    id: 'tx-123',
    amount: 100,
    asset: 'USDC',
    recipient: 'test@example.com',
    status: 'completed',
    timestamp: '2026-06-27T11:00:00Z',
    memo: 'Test payment',
    details: { fee: '2.5', platform: 'SwiftRemit' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate PDF for single transaction', () => {
    const downloadSpy = vi.fn();
    vi.mocked(require('jspdf').default).mockImplementation(() => ({
      internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
      setFontSize: vi.fn(),
      text: vi.fn(),
      setFont: vi.fn(),
      save: downloadSpy,
      addPage: vi.fn(),
    }));

    generatePDF(mockTransaction);

    expect(downloadSpy).toHaveBeenCalledWith('receipt-tx-123.pdf');
  });

  it('should generate bulk PDF for multiple transactions', () => {
    const downloadSpy = vi.fn();
    vi.mocked(require('jspdf').default).mockImplementation(() => ({
      internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
      setFontSize: vi.fn(),
      text: vi.fn(),
      setFont: vi.fn(),
      save: downloadSpy,
      addPage: vi.fn(),
    }));

    const transactions = [mockTransaction, mockTransaction];
    const dateRange = { from: new Date('2026-06-01'), to: new Date('2026-06-30') };

    generateBulkPDF(transactions, dateRange);

    expect(downloadSpy).toHaveBeenCalledWith(
      expect.stringContaining('export-2026-06-01-to-2026-06-30.pdf')
    );
  });

  it('should include transaction details in PDF', () => {
    const textSpy = vi.fn();
    vi.mocked(require('jspdf').default).mockImplementation(() => ({
      internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
      setFontSize: vi.fn(),
      text: textSpy,
      setFont: vi.fn(),
      save: vi.fn(),
      addPage: vi.fn(),
    }));

    generatePDF(mockTransaction);

    expect(textSpy).toHaveBeenCalledWith(expect.stringContaining('tx-123'), expect.any(Number), expect.any(Number));
  });
});
