import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TransactionHistory, TransactionHistoryItem } from '../TransactionHistory';
import '@testing-library/jest-dom';

const mockTransactions: TransactionHistoryItem[] = Array.from({ length: 25 }, (_, i) => ({
  id: `tx-${i}`,
  amount: 100 + i,
  asset: 'USDC',
  recipient: `recipient-${i}@example.com`,
  status: 'completed' as const,
  timestamp: new Date(2026, 0, i + 1).toISOString(),
}));

describe('TransactionHistory Pagination', () => {
  it('renders pagination controls with default page size', () => {
    render(<TransactionHistory transactions={mockTransactions} pageSize={10} />);

    expect(screen.getByText(/Showing 1–10 of 25 transactions/)).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
  });

  it('displays correct items on first page', () => {
    render(<TransactionHistory transactions={mockTransactions} pageSize={10} />);

    expect(screen.getByText('100 USDC')).toBeInTheDocument();
    expect(screen.getByText('109 USDC')).toBeInTheDocument();
    expect(screen.queryByText('110 USDC')).not.toBeInTheDocument();
  });

  it('navigates to next page', () => {
    render(<TransactionHistory transactions={mockTransactions} pageSize={10} />);

    const nextButton = screen.getByLabelText('Next page');
    fireEvent.click(nextButton);

    expect(screen.getByText(/Showing 11–20 of 25 transactions/)).toBeInTheDocument();
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
    expect(screen.getByText('110 USDC')).toBeInTheDocument();
  });

  it('navigates to previous page', () => {
    render(<TransactionHistory transactions={mockTransactions} pageSize={10} />);

    // Go to page 2 first (uncontrolled)
    fireEvent.click(screen.getByLabelText('Next page'));
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();

    // Now go back
    fireEvent.click(screen.getByLabelText('Previous page'));

    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    // "Showing 1–10 of 25 transactions" is split across elements — use a custom matcher
    expect(
      screen.getByText((_, element) => element?.textContent?.replace(/\s+/g, ' ').trim() === 'Showing 1–10 of 25 transactions')
    ).toBeInTheDocument();
  });

  it('disables previous button on first page', () => {
    render(<TransactionHistory transactions={mockTransactions} pageSize={10} />);

    const prevButton = screen.getByLabelText('Previous page');
    expect(prevButton).toBeDisabled();
  });

  it('disables next button on last page', () => {
    render(
      <TransactionHistory transactions={mockTransactions} pageSize={10} currentPage={3} />
    );

    const nextButton = screen.getByLabelText('Next page');
    expect(nextButton).toBeDisabled();
  });

  it('handles controlled pagination mode', () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <TransactionHistory
        transactions={mockTransactions}
        pageSize={10}
        currentPage={1}
        onPageChange={onPageChange}
      />
    );

    const nextButton = screen.getByLabelText('Next page');
    fireEvent.click(nextButton);

    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(
      <TransactionHistory
        transactions={mockTransactions}
        pageSize={10}
        currentPage={2}
        onPageChange={onPageChange}
      />
    );

    expect(screen.getByText(/Showing 11–20 of 25 transactions/)).toBeInTheDocument();
  });

  it('resets to page 1 when transactions change', () => {
    const { rerender } = render(
      <TransactionHistory transactions={mockTransactions} pageSize={10} currentPage={2} />
    );

    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();

    const newTransactions = mockTransactions.slice(0, 5);
    rerender(<TransactionHistory transactions={newTransactions} pageSize={10} />);

    expect(screen.getByText(/Page 1 of 1/)).toBeInTheDocument();
  });

  it('renders empty state correctly', () => {
    render(<TransactionHistory transactions={[]} pageSize={10} />);

    expect(screen.getByText('No transactions yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it('handles custom page size', () => {
    render(<TransactionHistory transactions={mockTransactions} pageSize={5} />);

    expect(screen.getByText(/Showing 1–5 of 25 transactions/)).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 5/)).toBeInTheDocument();
  });

  it('displays correct record count on last page', () => {
    render(
      <TransactionHistory transactions={mockTransactions} pageSize={10} currentPage={3} />
    );

    expect(screen.getByText(/Showing 21–25 of 25 transactions/)).toBeInTheDocument();
  });

  it('maintains pagination state across view mode changes', () => {
    render(
      <TransactionHistory transactions={mockTransactions} pageSize={10} currentPage={2} />
    );

    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();

    const cardButton = screen.getByRole('tab', { name: 'Cards' });
    fireEvent.click(cardButton);

    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/Showing 11–20 of 25 transactions/)).toBeInTheDocument();
  });

  it('has accessible pagination controls', () => {
    render(<TransactionHistory transactions={mockTransactions} pageSize={10} />);

    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav).toBeInTheDocument();

    const prevButton = screen.getByLabelText('Previous page');
    const nextButton = screen.getByLabelText('Next page');

    expect(prevButton).toHaveAttribute('type', 'button');
    expect(nextButton).toHaveAttribute('type', 'button');
  });

  it('updates aria-live region on page change', () => {
    const { rerender } = render(
      <TransactionHistory transactions={mockTransactions} pageSize={10} currentPage={1} />
    );

    const liveRegion = screen.getByText(/Showing 1–10 of 25 transactions/);
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');

    rerender(
      <TransactionHistory transactions={mockTransactions} pageSize={10} currentPage={2} />
    );

    expect(screen.getByText(/Showing 11–20 of 25 transactions/)).toBeInTheDocument();
  });
});
