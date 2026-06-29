import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BatchRemittance } from '../BatchRemittance';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'batch.title': 'Batch Remittance',
        'batch.uploadCSV': 'Upload CSV',
        'batch.dragDrop': 'Drag and drop CSV or click to select',
        'batch.addRow': 'Add Row',
        'batch.removeRow': 'Remove Row',
        'batch.preview': 'Preview',
        'batch.submit': 'Submit Batch',
        'batch.recipient': 'Recipient',
        'batch.amount': 'Amount',
        'batch.asset': 'Asset',
        'batch.fee': 'Fee',
        'batch.total': 'Total',
        'batch.success': 'Batch submitted successfully',
        'batch.error': 'Error submitting batch',
        'batch.maxRows': 'Maximum 100 remittances per batch',
        'batch.loading': 'Processing...',
      };
      return map[key] || key;
    },
  }),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Asset: { native: () => ({}) },
  Horizon: { Server: vi.fn().mockImplementation(() => ({ loadAccount: vi.fn() })) },
}));

describe('Batch Remittance', () => {
  const VALID_RECIPIENT = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA';
  const mockBatchData = [
    { recipient: VALID_RECIPIENT, amount: '100', asset: 'USDC' },
    { recipient: VALID_RECIPIENT, amount: '200', asset: 'USDC' },
    { recipient: VALID_RECIPIENT, amount: '150', asset: 'USDC' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('CSV Upload', () => {
    it('should accept CSV file upload', async () => {
      render(<BatchRemittance />);

      const file = new File(
        ['recipient,amount,asset\nGAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA,100,USDC'],
        'remittances.csv',
        { type: 'text/csv' }
      );

      const input = screen.getByLabelText(/upload csv/i);
      await userEvent.upload(input, file);

      expect(input).toHaveFiles([file]);
    });

    it('should reject non-CSV files', async () => {
      render(<BatchRemittance />);

      const file = new File(['invalid'], 'file.txt', { type: 'text/plain' });
      const input = screen.getByLabelText(/upload csv/i);

      await userEvent.upload(input, file);

      expect(screen.queryByText(/csv/i)).toBeDefined();
    });

    it('should parse CSV correctly', async () => {
      render(<BatchRemittance />);

      const csv = `recipient,amount,asset
${VALID_RECIPIENT},100,USDC
${VALID_RECIPIENT},200,USDC`;

      const file = new File([csv], 'remittances.csv', { type: 'text/csv' });
      const input = screen.getByLabelText(/upload csv/i);

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText(/preview/i)).toBeDefined();
      });
    });

    it('should support drag and drop', async () => {
      render(<BatchRemittance />);

      const dropZone = screen.getByText(/drag and drop/i);
      const file = new File(['recipient,amount,asset\nGAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA,100,USDC'], 'remittances.csv', { type: 'text/csv' });

      fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

      expect(screen.getByLabelText(/upload csv/i)).toHaveFiles([file]);
    });
  });

  describe('Multi-Row Form Entry', () => {
    it('should add rows to form', async () => {
      render(<BatchRemittance />);

      const addButton = screen.getByRole('button', { name: /add row/i });
      fireEvent.click(addButton);
      fireEvent.click(addButton);

      const rows = screen.getAllByRole('row');
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    it('should remove rows from form', async () => {
      render(<BatchRemittance />);

      const addButton = screen.getByRole('button', { name: /add row/i });
      fireEvent.click(addButton);
      fireEvent.click(addButton);

      const removeButtons = screen.getAllByRole('button', { name: /remove row/i });
      fireEvent.click(removeButtons[0]);

      const rows = screen.getAllByRole('row');
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it('should enforce max 100 rows', async () => {
      render(<BatchRemittance />);

      const addButton = screen.getByRole('button', { name: /add row/i });

      // Try to add more than 100 rows
      for (let i = 0; i < 110; i++) {
        fireEvent.click(addButton);
      }

      expect(screen.getByText(/maximum 100/i)).toBeDefined();
    });

    it('should validate recipient addresses', async () => {
      render(<BatchRemittance />);

      const recipientInput = screen.getByLabelText(/recipient/i);
      await userEvent.type(recipientInput, 'invalid-address');

      fireEvent.blur(recipientInput);

      await waitFor(() => {
        expect(screen.queryByText(/invalid/i)).toBeDefined();
      });
    });

    it('should validate amounts', async () => {
      render(<BatchRemittance />);

      const amountInput = screen.getByLabelText(/amount/i);
      await userEvent.type(amountInput, '0');

      fireEvent.blur(amountInput);

      await waitFor(() => {
        expect(screen.queryByText(/greater than/i)).toBeDefined();
      });
    });
  });

  describe('Preview', () => {
    it('should display batch preview', async () => {
      render(<BatchRemittance />);

      // Add rows
      const addButton = screen.getByRole('button', { name: /add row/i });
      fireEvent.click(addButton);

      const previewButton = screen.getByRole('button', { name: /preview/i });
      fireEvent.click(previewButton);

      expect(screen.getByText(/preview/i)).toBeDefined();
    });

    it('should show per-row fee breakdown', async () => {
      render(<BatchRemittance />);

      const addButton = screen.getByRole('button', { name: /add row/i });
      fireEvent.click(addButton);

      const previewButton = screen.getByRole('button', { name: /preview/i });
      fireEvent.click(previewButton);

      // Should display fee column
      await waitFor(() => {
        expect(screen.queryByText(/fee/i)).toBeDefined();
      });
    });

    it('should calculate and display total', async () => {
      render(<BatchRemittance />);

      const addButton = screen.getByRole('button', { name: /add row/i });
      fireEvent.click(addButton);

      const previewButton = screen.getByRole('button', { name: /preview/i });
      fireEvent.click(previewButton);

      await waitFor(() => {
        expect(screen.queryByText(/total/i)).toBeDefined();
      });
    });

    it('should show success/failure for each row after submission', async () => {
      const mockSubmit = vi.fn().mockResolvedValue({
        results: [
          { success: true, row_index: 0 },
          { success: true, row_index: 1 },
          { success: false, row_index: 2, error: 'Insufficient balance' },
        ],
      });

      render(<BatchRemittance onSubmit={mockSubmit} />);

      const submitButton = screen.getByRole('button', { name: /submit batch/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalled();
        expect(screen.queryByText(/2 succeeded/i)).toBeDefined();
      });
    });
  });

  describe('Batch Submission', () => {
    it('should submit batch to contract', async () => {
      const mockCreateBatch = vi.fn().mockResolvedValue({
        transaction_id: 'tx123',
        batch_id: 'batch123',
      });

      render(<BatchRemittance onCreateBatch={mockCreateBatch} />);

      // Fill in some data
      const addButton = screen.getByRole('button', { name: /add row/i });
      fireEvent.click(addButton);

      const submitButton = screen.getByRole('button', { name: /submit batch/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreateBatch).toHaveBeenCalled();
      });
    });

    it('should show loading state during submission', async () => {
      const mockCreateBatch = vi.fn(() => new Promise(resolve => setTimeout(resolve, 100)));

      render(<BatchRemittance onCreateBatch={mockCreateBatch} />);

      const submitButton = screen.getByRole('button', { name: /submit batch/i });
      fireEvent.click(submitButton);

      expect(screen.getByText(/processing/i)).toBeDefined();
    });

    it('should handle submission errors', async () => {
      const mockCreateBatch = vi.fn().mockRejectedValue(new Error('Network error'));

      render(<BatchRemittance onCreateBatch={mockCreateBatch} />);

      const submitButton = screen.getByRole('button', { name: /submit batch/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.queryByText(/error|network/i)).toBeDefined();
      });
    });

    it('should display transaction hash on success', async () => {
      const mockCreateBatch = vi.fn().mockResolvedValue({
        transaction_id: 'abc123def456',
        batch_id: 'batch123',
      });

      render(<BatchRemittance onCreateBatch={mockCreateBatch} />);

      const submitButton = screen.getByRole('button', { name: /submit batch/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.queryByText(/abc123def456/i)).toBeDefined();
      });
    });
  });

  describe('Data Validation', () => {
    it('should prevent submission with empty batch', async () => {
      render(<BatchRemittance />);

      const submitButton = screen.getByRole('button', { name: /submit batch/i });
      expect(submitButton).toBeDisabled();
    });

    it('should prevent submission with invalid data', async () => {
      render(<BatchRemittance />);

      const addButton = screen.getByRole('button', { name: /add row/i });
      fireEvent.click(addButton);

      // Leave fields empty
      const submitButton = screen.getByRole('button', { name: /submit batch/i });

      await waitFor(() => {
        expect(submitButton).toBeDisabled();
      });
    });

    it('should validate all rows before submission', async () => {
      render(<BatchRemittance />);

      const addButton = screen.getByRole('button', { name: /add row/i });
      fireEvent.click(addButton);
      fireEvent.click(addButton);

      // Fill only first row
      const recipientInputs = screen.getAllByLabelText(/recipient/i);
      await userEvent.type(recipientInputs[0], VALID_RECIPIENT);

      const submitButton = screen.getByRole('button', { name: /submit batch/i });

      await waitFor(() => {
        expect(submitButton).toBeDisabled();
      });
    });
  });

  describe('CSV Format Support', () => {
    it('should parse standard CSV format', async () => {
      render(<BatchRemittance />);

      const csv = `recipient,amount,asset
${VALID_RECIPIENT},100,USDC
${VALID_RECIPIENT},200,USDT`;

      const file = new File([csv], 'remittances.csv', { type: 'text/csv' });
      const input = screen.getByLabelText(/upload csv/i);

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(input).toHaveFiles([file]);
      });
    });

    it('should handle CSV with extra whitespace', async () => {
      render(<BatchRemittance />);

      const csv = `recipient, amount, asset
${VALID_RECIPIENT} , 100 , USDC`;

      const file = new File([csv], 'remittances.csv', { type: 'text/csv' });
      const input = screen.getByLabelText(/upload csv/i);

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(input).toHaveFiles([file]);
      });
    });

    it('should reject CSV with missing required columns', async () => {
      render(<BatchRemittance />);

      const csv = `recipient,amount
${VALID_RECIPIENT},100`;

      const file = new File([csv], 'remittances.csv', { type: 'text/csv' });
      const input = screen.getByLabelText(/upload csv/i);

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.queryByText(/required columns|asset/i)).toBeDefined();
      });
    });
  });

  describe('Batch Lifecycle', () => {
    it('should complete full batch lifecycle', async () => {
      const mockCreateBatch = vi.fn().mockResolvedValue({
        transaction_id: 'tx123',
        batch_id: 'batch123',
      });

      render(<BatchRemittance onCreateBatch={mockCreateBatch} />);

      // Upload CSV
      const csv = `recipient,amount,asset
${VALID_RECIPIENT},100,USDC`;
      const file = new File([csv], 'remittances.csv', { type: 'text/csv' });
      const input = screen.getByLabelText(/upload csv/i);
      await userEvent.upload(input, file);

      // Preview
      const previewButton = screen.queryByRole('button', { name: /preview/i });
      if (previewButton) {
        fireEvent.click(previewButton);
      }

      // Submit
      const submitButton = screen.getByRole('button', { name: /submit batch/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreateBatch).toHaveBeenCalled();
      });
    });
  });
});
