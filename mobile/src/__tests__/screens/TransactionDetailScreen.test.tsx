import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Linking, Share } from 'react-native';
import TransactionDetailScreen from '../../screens/TransactionDetailScreen';
import { remittanceService } from '../../services/api';
import { Receipt, Remittance } from '../../types';

jest.mock('../../services/api', () => ({
  remittanceService: {
    getById: jest.fn(),
    getReceipt: jest.fn(),
  },
}));

const mockGetById = remittanceService.getById as jest.Mock;
const mockGetReceipt = remittanceService.getReceipt as jest.Mock;

const { useRoute } = require('@react-navigation/native');

const SAMPLE: Remittance = {
  remittance_id: 'rm-abc-123',
  sender: 'GABCDEF',
  agent: 'Agent Kenya',
  amount: '500.00',
  fee: '12.50',
  currency: 'KES',
  status: 'completed',
  memo: 'Rent payment',
  created_at: '2026-03-10T08:00:00Z',
  updated_at: '2026-03-10T08:10:00Z',
};

const SAMPLE_RECEIPT: Receipt = {
  remittance_id: 'rm-abc-123',
  sender: 'GABCDEF',
  recipient: 'Jane Doe',
  amount_sent: '500.00',
  currency_from: 'USD',
  amount_received: '476.46',
  currency_to: 'KES',
  fx_rate: 126.55,
  fees_charged: '12.50',
  transfer_date: '2026-03-10T08:00:00Z',
  status: 'completed',
  proof_of_payout_url: 'https://example.com/proof-of-payout.pdf',
};

describe('TransactionDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    useRoute.mockReturnValue({
      params: { remittanceId: 'rm-abc-123' },
      key: 'TransactionDetail',
      name: 'TransactionDetail',
    });
  });

  // ── Loading state ──────────────────────────────────────────────────────
  it('shows a loading spinner while fetching', async () => {
    mockGetById.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = await render(<TransactionDetailScreen />);
    expect(getByTestId('loading-indicator')).toBeTruthy();
  });

  // ── Not-found / error state ────────────────────────────────────────────
  it('shows "Transfer not found" when the API resolves to null', async () => {
    mockGetById.mockResolvedValue(null);
    const { getByText } = await render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(getByText('Transfer not found.')).toBeTruthy();
    });
  });

  it('shows "Transfer not found" when the API rejects', async () => {
    mockGetById.mockRejectedValue(new Error('404'));
    const { getByText } = await render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(getByText('Transfer not found.')).toBeTruthy();
    });
  });

  // ── Populated state ────────────────────────────────────────────────────
  it('renders all remittance detail rows after loading', async () => {
    mockGetById.mockResolvedValue(SAMPLE);
    const { getByText } = await render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(getByText('rm-abc-123')).toBeTruthy();
    });
    expect(getByText('$500.00 USD')).toBeTruthy();
    expect(getByText('Rent payment')).toBeTruthy();
    expect(getByText('Transfer Details')).toBeTruthy();
  });

  it('renders the progress stepper', async () => {
    mockGetById.mockResolvedValue(SAMPLE);
    const { getByText } = await render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(getByText('Transfer Details')).toBeTruthy();
    });
  });

  it('calls getById with the route remittanceId param', async () => {
    mockGetById.mockResolvedValue(SAMPLE);
    await render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(mockGetById).toHaveBeenCalledWith('rm-abc-123');
    });
  });

  it('does not show memo row when memo is null', async () => {
    mockGetById.mockResolvedValue({ ...SAMPLE, memo: null });
    const { queryByText } = await render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(queryByText('Rent payment')).toBeNull();
    });
  });

  it('formats the status with spaces instead of underscores', async () => {
    mockGetById.mockResolvedValue({ ...SAMPLE, status: 'pending_user_transfer_start' });
    const { getByText } = await render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(getByText('pending user transfer start')).toBeTruthy();
    });
  });

  it('shares the receipt via the native share sheet', async () => {
    mockGetById.mockResolvedValue(SAMPLE);
    mockGetReceipt.mockResolvedValue(SAMPLE_RECEIPT);
    const { getByText } = await render(<TransactionDetailScreen />);

    await waitFor(() => {
      expect(getByText('Share receipt')).toBeTruthy();
    });

    fireEvent.press(getByText('Share receipt'));

    await waitFor(() => {
      expect(Share.share).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.any(String),
          message: expect.stringContaining('Jane Doe'),
        })
      );
    });
  });

  it('opens the proof of payout URL and surfaces failures', async () => {
    mockGetById.mockResolvedValue(SAMPLE);
    mockGetReceipt.mockResolvedValue(SAMPLE_RECEIPT);
    const { getByText } = await render(<TransactionDetailScreen />);

    await waitFor(() => {
      expect(getByText('View receipt')).toBeTruthy();
    });

    fireEvent.press(getByText('View receipt'));
    await waitFor(() => {
      expect(getByText('Proof of payout')).toBeTruthy();
    });

    fireEvent.press(getByText('Proof of payout'));
    await waitFor(() => {
      expect(Linking.openURL).toHaveBeenCalledWith(SAMPLE_RECEIPT.proof_of_payout_url);
    });

    (Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error('blocked'));
    fireEvent.press(getByText('Proof of payout'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Unable to open the proof of payout.');
    });
  });
});
