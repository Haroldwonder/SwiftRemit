/**
 * Tests for TransactionHistoryScreen (SR-187)
 *
 * SR-187 additions:
 * - Second page is requested when FlatList fires onEndReached.
 * - Duplicate items from repeated page loads are not rendered twice.
 * - Search input filters visible rows.
 * - Status filter strips rows that don't match.
 */
import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';
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

function makeRemittance(id: string, overrides: Partial<Remittance> = {}): Remittance {
  return {
    remittance_id: id,
    sender: 'GABCD',
    agent: 'Agent Philippines',
    amount: '100.00',
    fee: '2.50',
    currency: 'PHP',
    status: 'completed',
    memo: null,
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:05:00Z',
    ...overrides,
  };
}

const PAGE_1 = [makeRemittance('rm-001', { amount: '250.00' }), makeRemittance('rm-002', { amount: '100.00', status: 'pending_external' })];
const PAGE_2 = [makeRemittance('rm-003', { amount: '75.00', agent: 'Agent Mexico' })];

describe('TransactionHistoryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useNavigation.mockReturnValue({ navigate: mockNavigate });
    mockGetItemAsync.mockResolvedValue('wallet-address-123');
  });

  // ── Loading state ──────────────────────────────────────────────────────
  it('shows a loading spinner while fetching data', async () => {
    mockGetHistory.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = await render(<TransactionHistoryScreen />);
    expect(getByTestId('loading-indicator')).toBeTruthy();
  });

  // ── Empty state ────────────────────────────────────────────────────────
  it('shows the empty state when no remittances are returned', async () => {
    mockGetHistory.mockResolvedValue({ remittances: [], nextCursor: null });
    const { getByText } = await render(<TransactionHistoryScreen />);
    await waitFor(() => {
      expect(getByText('No transfers found.')).toBeTruthy();
    });
  });

  // ── Populated state ────────────────────────────────────────────────────
  it('renders a list of remittances after loading', async () => {
    mockGetHistory.mockResolvedValue({ remittances: PAGE_1, nextCursor: null });
    const { getByText } = await render(<TransactionHistoryScreen />);
    await waitFor(() => {
      expect(getByText('$250.00 USD')).toBeTruthy();
    });
    expect(getByText('$100.00 USD')).toBeTruthy();
  });

  it('displays the correct status badge label for a completed remittance', async () => {
    mockGetHistory.mockResolvedValue({ remittances: [PAGE_1[0]], nextCursor: null });
    const { getByText } = await render(<TransactionHistoryScreen />);
    await waitFor(() => expect(getByText('Completed')).toBeTruthy());
  });

  it('displays the correct status badge label for a pending remittance', async () => {
    mockGetHistory.mockResolvedValue({ remittances: [PAGE_1[1]], nextCursor: null });
    const { getByText } = await render(<TransactionHistoryScreen />);
    await waitFor(() => expect(getByText('Processing')).toBeTruthy());
  });

  // ── SR-187: Pagination — second page requested on scroll-to-end ────────
  it('calls getHistory a second time when FlatList fires onEndReached', async () => {
    mockGetHistory
      .mockResolvedValueOnce({ remittances: PAGE_1, nextCursor: 'cursor-page-2' })
      .mockResolvedValueOnce({ remittances: PAGE_2, nextCursor: null });

    const { getByTestId, getByText } = await render(<TransactionHistoryScreen />);
    await waitFor(() => expect(getByText('$250.00 USD')).toBeTruthy());

    // Simulate reaching the end of the list
    await act(async () => {
      const list = getByTestId('transaction-list');
      fireEvent(list, 'onEndReached');
    });

    await waitFor(() => {
      expect(mockGetHistory).toHaveBeenCalledTimes(2);
      // Second call must include the cursor
      expect(mockGetHistory).toHaveBeenNthCalledWith(2, 'wallet-address-123', 20, 'cursor-page-2');
    });
  });

  // ── SR-187: No duplicate items after pagination ────────────────────────
  it('does not render duplicate items when the same page is loaded twice', async () => {
    mockGetHistory
      .mockResolvedValueOnce({ remittances: PAGE_1, nextCursor: 'cursor-page-2' })
      .mockResolvedValueOnce({ remittances: PAGE_1, nextCursor: null }); // Same data returned

    const { getByTestId, getAllByText } = await render(<TransactionHistoryScreen />);
    await waitFor(() => getAllByText('$250.00 USD'));

    await act(async () => {
      const list = getByTestId('transaction-list');
      fireEvent(list, 'onEndReached');
    });

    await waitFor(() => expect(mockGetHistory).toHaveBeenCalledTimes(2));

    // $250.00 USD should appear exactly once (deduplication by remittance_id)
    const items = getAllByText('$250.00 USD');
    expect(items).toHaveLength(1);
  });

  // ── SR-187: Second page items are appended, not replaced ──────────────
  it('appends page 2 items after page 1 items', async () => {
    mockGetHistory
      .mockResolvedValueOnce({ remittances: PAGE_1, nextCursor: 'cursor-page-2' })
      .mockResolvedValueOnce({ remittances: PAGE_2, nextCursor: null });

    const { getByTestId, getByText } = await render(<TransactionHistoryScreen />);
    await waitFor(() => expect(getByText('$250.00 USD')).toBeTruthy());

    await act(async () => {
      const list = getByTestId('transaction-list');
      fireEvent(list, 'onEndReached');
    });

    await waitFor(() => {
      // Both pages visible
      expect(getByText('$250.00 USD')).toBeTruthy();
      expect(getByText('$75.00 USD')).toBeTruthy();
    });
  });

  // ── SR-187: Search filter ──────────────────────────────────────────────
  it('filters items by agent name when user types in the search box', async () => {
    const mixed = [
      makeRemittance('rm-001', { agent: 'Agent Philippines', amount: '250.00' }),
      makeRemittance('rm-002', { agent: 'Agent Mexico', amount: '100.00' }),
    ];
    mockGetHistory.mockResolvedValue({ remittances: mixed, nextCursor: null });
    const { getByTestId, getByText, queryByText } = await render(<TransactionHistoryScreen />);
    await waitFor(() => expect(getByText('$250.00 USD')).toBeTruthy());

    fireEvent.changeText(getByTestId('search-input'), 'mexico');

    await waitFor(() => {
      expect(getByText('$100.00 USD')).toBeTruthy();
      expect(queryByText('$250.00 USD')).toBeNull();
    });
  });

  // ── SR-187: Status filter ──────────────────────────────────────────────
  it('filters items by status when the "Completed" filter is pressed', async () => {
    const mixed = [
      makeRemittance('rm-001', { status: 'completed', amount: '250.00' }),
      makeRemittance('rm-002', { status: 'error', amount: '100.00' }),
    ];
    mockGetHistory.mockResolvedValue({ remittances: mixed, nextCursor: null });
    const { getByTestId, getByText, queryByText } = await render(<TransactionHistoryScreen />);
    await waitFor(() => expect(getByText('$250.00 USD')).toBeTruthy());

    fireEvent.press(getByTestId('filter-completed'));

    await waitFor(() => {
      expect(getByText('$250.00 USD')).toBeTruthy();
      expect(queryByText('$100.00 USD')).toBeNull();
    });
  });

  // ── Navigation ─────────────────────────────────────────────────────────
  it('navigates to TransactionDetail when a row is pressed', async () => {
    mockGetHistory.mockResolvedValue({ remittances: PAGE_1, nextCursor: null });
    const { getByText } = await render(<TransactionHistoryScreen />);
    await waitFor(() => expect(getByText('$250.00 USD')).toBeTruthy());
    fireEvent.press(getByText('$250.00 USD'));
    expect(mockNavigate).toHaveBeenCalledWith('TransactionDetail', { remittanceId: 'rm-001' });
  });

  // ── Error state ────────────────────────────────────────────────────────
  it('keeps stale data (empty list) gracefully when the API throws', async () => {
    mockGetHistory.mockRejectedValue(new Error('Network error'));
    const { getByText } = await render(<TransactionHistoryScreen />);
    await waitFor(() => {
      expect(getByText('No transfers found.')).toBeTruthy();
    });
  });

  // ── No wallet ──────────────────────────────────────────────────────────
  it('does not call the API when no wallet address is stored', async () => {
    mockGetItemAsync.mockResolvedValue(null);
    await render(<TransactionHistoryScreen />);
    await waitFor(() => {
      expect(mockGetHistory).not.toHaveBeenCalled();
    });
  });
});
