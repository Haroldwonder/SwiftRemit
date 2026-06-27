import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PDFExport } from '../PDFExport';
import * as pdfService from '../../services/pdfExportService';
import type { TransactionHistoryItem } from '../TransactionHistory';

vi.mock('../../services/pdfExportService');

describe('PDFExport', () => {
  const mockTransactions: TransactionHistoryItem[] = [
    {
      id: 'tx-1',
      amount: 100,
      asset: 'USDC',
      recipient: 'test1@example.com',
      status: 'completed',
      timestamp: '2026-06-27T10:00:00Z',
    },
    {
      id: 'tx-2',
      amount: 200,
      asset: 'USDC',
      recipient: 'test2@example.com',
      status: 'completed',
      timestamp: '2026-06-27T11:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render export controls', () => {
    render(<PDFExport transactions={mockTransactions} />);

    expect(screen.getByLabelText('Export date range start')).toBeInTheDocument();
    expect(screen.getByLabelText('Export date range end')).toBeInTheDocument();
    expect(screen.getByText('Export PDF')).toBeInTheDocument();
  });

  it('should export single transaction PDF', () => {
    render(<PDFExport transactions={mockTransactions} />);

    const downloadButtons = screen.getAllByText('Download Receipt');
    fireEvent.click(downloadButtons[0]);

    expect(pdfService.generatePDF).toHaveBeenCalledWith(mockTransactions[0]);
  });

  it('should export bulk PDF with all transactions', () => {
    render(<PDFExport transactions={mockTransactions} />);

    fireEvent.click(screen.getByText('Export PDF'));

    expect(pdfService.generateBulkPDF).toHaveBeenCalledWith(
      mockTransactions,
      undefined
    );
  });

  it('should filter transactions by date range', () => {
    render(<PDFExport transactions={mockTransactions} />);

    const dateFromInput = screen.getByLabelText('Export date range start') as HTMLInputElement;
    const dateToInput = screen.getByLabelText('Export date range end') as HTMLInputElement;

    fireEvent.change(dateFromInput, { target: { value: '2026-06-27' } });
    fireEvent.change(dateToInput, { target: { value: '2026-06-27' } });
    fireEvent.click(screen.getByText('Export PDF'));

    expect(pdfService.generateBulkPDF).toHaveBeenCalled();
  });

  it('should disable export button when no transactions', () => {
    render(<PDFExport transactions={[]} />);

    expect(screen.getByText('Export PDF')).toBeDisabled();
  });
});
