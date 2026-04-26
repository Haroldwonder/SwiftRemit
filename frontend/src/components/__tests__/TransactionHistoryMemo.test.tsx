/**
 * Tests for memo display in TransactionHistory.
 *
 * Covers:
 * - Memo appears in expanded table row when present
 * - Memo appears in expanded card when present
 * - Memo is hidden when not set
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TransactionHistory } from '../TransactionHistory';
import type { TransactionHistoryItem } from '../TransactionHistory';

afterEach(cleanup);

const BASE_TX: TransactionHistoryItem = {
  id: 'tx-1',
  amount: 100,
  asset: 'USDC',
  recipient: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA',
  status: 'completed',
  timestamp: '2024-01-01T00:00:00Z',
};

describe('TransactionHistory – memo display', () => {
  it('shows memo in expanded table row when memo is present', () => {
    const tx = { ...BASE_TX, memo: 'Invoice #1234' };
    render(<TransactionHistory transactions={[tx]} defaultView="table" />);

    fireEvent.click(screen.getByRole('button', { name: /expand/i }));

    expect(screen.getByText('Memo')).toBeInTheDocument();
    expect(screen.getByText('Invoice #1234')).toBeInTheDocument();
  });

  it('does not show memo row in table when memo is absent', () => {
    render(<TransactionHistory transactions={[BASE_TX]} defaultView="table" />);

    fireEvent.click(screen.getByRole('button', { name: /expand/i }));

    expect(screen.queryByText('Memo')).not.toBeInTheDocument();
  });

  it('shows memo in expanded card when memo is present', () => {
    const tx = { ...BASE_TX, memo: 'REF-2024-007' };
    render(<TransactionHistory transactions={[tx]} defaultView="card" />);

    fireEvent.click(screen.getByRole('button', { name: /expand details/i }));

    expect(screen.getByText('Memo')).toBeInTheDocument();
    expect(screen.getByText('REF-2024-007')).toBeInTheDocument();
  });

  it('does not show memo row in card when memo is absent', () => {
    render(<TransactionHistory transactions={[BASE_TX]} defaultView="card" />);

    fireEvent.click(screen.getByRole('button', { name: /expand details/i }));

    expect(screen.queryByText('Memo')).not.toBeInTheDocument();
  });
});

describe('TransactionHistory – loading state', () => {
  it('shows skeleton rows in table view when loading and no transactions', () => {
    render(<TransactionHistory transactions={[]} defaultView="table" isLoading={true} />);

    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(6); // 1 header + 5 skeleton rows
  });

  it('shows skeleton cards in card view when loading and no transactions', () => {
    render(<TransactionHistory transactions={[]} defaultView="card" isLoading={true} />);

    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(4); // 4 skeleton cards
  });

  it('does not show skeletons when not loading', () => {
    render(<TransactionHistory transactions={[]} defaultView="table" isLoading={false} />);

    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument();
  });

  it('shows loading spinner when loading and has transactions', () => {
    render(<TransactionHistory transactions={[BASE_TX]} defaultView="table" isLoading={true} />);

    expect(screen.getByText('Loading more transactions...')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
