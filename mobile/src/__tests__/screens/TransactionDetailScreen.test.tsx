import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import TransactionDetailScreen from '../../screens/TransactionDetailScreen';
import { remittanceService } from '../../services/api';
import { Remittance } from '../../types';

jest.mock('../../services/api', () => ({
  remittanceService: {
    getById: jest.fn(),
  },
}));

const mockGetById = remittanceService.getById as jest.Mock;

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

describe('TransactionDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRoute.mockReturnValue({
      params: { remittanceId: 'rm-abc-123' },
      key: 'TransactionDetail',
      name: 'TransactionDetail',
    });
  });

  // ── Loading state ──────────────────────────────────────────────────────
  it('shows a loading spinner while fetching', () => {
    mockGetById.mockReturnValue(new Promise(() => {}));
    const { UNSAFE_getByType } = render(<TransactionDetailScreen />);
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  // ── Not-found / error state ────────────────────────────────────────────
  it('shows "Transfer not found" when the API resolves to null', async () => {
    mockGetById.mockResolvedValue(null);
    const { getByText } = render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(getByText('Transfer not found.')).toBeTruthy();
    });
  });

  it('shows "Transfer not found" when the API rejects', async () => {
    mockGetById.mockRejectedValue(new Error('404'));
    const { getByText } = render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(getByText('Transfer not found.')).toBeTruthy();
    });
  });

  // ── Populated state ────────────────────────────────────────────────────
  it('renders all remittance detail rows after loading', async () => {
    mockGetById.mockResolvedValue(SAMPLE);
    const { getByText } = render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(getByText('rm-abc-123')).toBeTruthy();
    });
    expect(getByText('$500.00 USD')).toBeTruthy();
    expect(getByText('Rent payment')).toBeTruthy();
    expect(getByText('Transfer Details')).toBeTruthy();
  });

  it('renders the progress stepper', async () => {
    mockGetById.mockResolvedValue(SAMPLE);
    const { getByText } = render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(getByText('Transfer Details')).toBeTruthy();
    });
  });

  it('calls getById with the route remittanceId param', async () => {
    mockGetById.mockResolvedValue(SAMPLE);
    render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(mockGetById).toHaveBeenCalledWith('rm-abc-123');
    });
  });

  it('does not show memo row when memo is null', async () => {
    mockGetById.mockResolvedValue({ ...SAMPLE, memo: null });
    const { queryByText } = render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(queryByText('Rent payment')).toBeNull();
    });
  });

  it('formats the status with spaces instead of underscores', async () => {
    mockGetById.mockResolvedValue({ ...SAMPLE, status: 'pending_user_transfer_start' });
    const { getByText } = render(<TransactionDetailScreen />);
    await waitFor(() => {
      expect(getByText('pending user transfer start')).toBeTruthy();
    });
  });
});
