import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import TransactionHistoryScreen from '../../screens/TransactionHistoryScreen';
import { remittanceService } from '../../services/api';
import * as SecureStore from 'expo-secure-store';
import { Remittance } from '../../types';

jest.mock('../../services/api', () => ({
  remittanceService: {
    getHistory: jest.fn(),
  },
}));

const mockGetHistory = remittanceService.getHistory as jest.Mock;
const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;

const { useNavigation } = require('@react-navigation/native');
const mockNavigate = jest.fn();

const SAMPLE_REMITTANCES: Remittance[] = [
  {
    remittance_id: 'rm-001',
    sender: 'GABCD',
    agent: 'Agent Philippines',
    amount: '250.00',
    fee: '6.25',
    currency: 'PHP',
    status: 'completed',
    memo: 'School fees',
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:05:00Z',
  },
  {
    remittance_id: 'rm-002',
    sender: 'GABCD',
    agent: 'Agent Mexico',
    amount: '100.00',
    fee: null,
    currency: 'MXN',
    status: 'pending_external',
    memo: null,
    created_at: '2026-02-01T09:00:00Z',
    updated_at: '2026-02-01T09:01:00Z',
  },
];

describe('TransactionHistoryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useNavigation.mockReturnValue({ navigate: mockNavigate });
    mockGetItemAsync.mockResolvedValue('wallet-address-123');
  });

  // ── Loading state ──────────────────────────────────────────────────────
  it('shows a loading spinner while fetching data', () => {
    // Never resolves so we stay in loading state
    mockGetHistory.mockReturnValue(new Promise(() => {}));
    const { getByTestId, UNSAFE_getByType } = render(<TransactionHistoryScreen />);
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  // ── Empty state ────────────────────────────────────────────────────────
  it('shows the empty state when no remittances are returned', async () => {
    mockGetHistory.mockResolvedValue([]);
    const { getByText } = render(<TransactionHistoryScreen />);
    await waitFor(() => {
      expect(getByText('No transfers yet.')).toBeTruthy();
    });
    expect(getByText('Your transaction history will appear here.')).toBeTruthy();
  });

  // ── Populated state ────────────────────────────────────────────────────
  it('renders a list of remittances after loading', async () => {
    mockGetHistory.mockResolvedValue(SAMPLE_REMITTANCES);
    const { getByText } = render(<TransactionHistoryScreen />);
    await waitFor(() => {
      expect(getByText('$250.00 USD')).toBeTruthy();
    });
    expect(getByText('Agent Philippines')).toBeTruthy();
    expect(getByText('$100.00 USD')).toBeTruthy();
    expect(getByText('Agent Mexico')).toBeTruthy();
  });

  it('displays the correct status badge label for a completed remittance', async () => {
    mockGetHistory.mockResolvedValue([SAMPLE_REMITTANCES[0]]);
    const { getByText } = render(<TransactionHistoryScreen />);
    await waitFor(() => expect(getByText('Completed')).toBeTruthy());
  });

  it('displays the correct status badge label for a pending remittance', async () => {
    mockGetHistory.mockResolvedValue([SAMPLE_REMITTANCES[1]]);
    const { getByText } = render(<TransactionHistoryScreen />);
    await waitFor(() => expect(getByText('Processing')).toBeTruthy());
  });

  // ── Navigation ─────────────────────────────────────────────────────────
  it('navigates to TransactionDetail when a row is pressed', async () => {
    mockGetHistory.mockResolvedValue(SAMPLE_REMITTANCES);
    const { getByText } = render(<TransactionHistoryScreen />);
    await waitFor(() => expect(getByText('$250.00 USD')).toBeTruthy());
    fireEvent.press(getByText('$250.00 USD'));
    expect(mockNavigate).toHaveBeenCalledWith('TransactionDetail', { remittanceId: 'rm-001' });
  });

  // ── Error state ────────────────────────────────────────────────────────
  it('keeps stale data (empty list) gracefully when the API throws', async () => {
    mockGetHistory.mockRejectedValue(new Error('Network error'));
    const { getByText } = render(<TransactionHistoryScreen />);
    await waitFor(() => {
      expect(getByText('No transfers yet.')).toBeTruthy();
    });
  });

  // ── No wallet ──────────────────────────────────────────────────────────
  it('does not call the API when no wallet address is stored', async () => {
    mockGetItemAsync.mockResolvedValue(null);
    render(<TransactionHistoryScreen />);
    await waitFor(() => {
      expect(mockGetHistory).not.toHaveBeenCalled();
    });
  });
});
