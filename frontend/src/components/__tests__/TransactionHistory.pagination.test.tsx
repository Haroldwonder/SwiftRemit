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

  // New tests for onLoadMore functionality
  describe('onLoadMore functionality', () => {
    it('renders load more button in infinite pagination mode', () => {
      const onLoadMore = vi.fn();
      render(
        <TransactionHistory
          transactions={mockTransactions}
          paginationMode="infinite"
          onLoadMore={onLoadMore}
          hasMore={true}
        />
      );

      expect(screen.getByText('Load More')).toBeInTheDocument();
      expect(screen.getByLabelText('Load more transactions')).toBeInTheDocument();
    });

    it('calls onLoadMore when load more button is clicked', async () => {
      const onLoadMore = vi.fn().mockResolvedValue(undefined);
      render(
        <TransactionHistory
          transactions={mockTransactions}
          paginationMode="infinite"
          onLoadMore={onLoadMore}
          hasMore={true}
        />
      );

      const loadMoreButton = screen.getByText('Load More');
      fireEvent.click(loadMoreButton);

      expect(onLoadMore).toHaveBeenCalledWith(2);
    });

    it('shows loading state when fetching more data', async () => {
      const onLoadMore = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
      render(
        <TransactionHistory
          transactions={mockTransactions}
          paginationMode="infinite"
          onLoadMore={onLoadMore}
          hasMore={true}
          isLoading={false}
        />
      );

      const loadMoreButton = screen.getByText('Load More');
      fireEvent.click(loadMoreButton);

      // Should show loading state
      expect(screen.getByText('Loading...')).toBeInTheDocument();
      expect(screen.getByText('Load More')).toBeDisabled();
    });

    it('disables load more button when hasMore is false', () => {
      const onLoadMore = vi.fn();
      render(
        <TransactionHistory
          transactions={mockTransactions}
          paginationMode="infinite"
          onLoadMore={onLoadMore}
          hasMore={false}
        />
      );

      const loadMoreButton = screen.getByText('Load More');
      expect(loadMoreButton).toBeDisabled();
    });

    it('disables load more button when isLoading is true', () => {
      const onLoadMore = vi.fn();
      render(
        <TransactionHistory
          transactions={mockTransactions}
          paginationMode="infinite"
          onLoadMore={onLoadMore}
          hasMore={true}
          isLoading={true}
        />
      );

      const loadMoreButton = screen.getByText('Load More');
      expect(loadMoreButton).toBeDisabled();
    });
  });

  // New tests for infinite scroll functionality
  describe('infinite scroll functionality', () => {
    it('renders infinite scroll sentinel when enabled', () => {
      const onLoadMore = vi.fn();
      render(
        <TransactionHistory
          transactions={mockTransactions}
          paginationMode="infinite"
          onLoadMore={onLoadMore}
          hasMore={true}
          enableInfiniteScroll={true}
        />
      );

      const sentinel = document.querySelector('.infinite-scroll-sentinel');
      expect(sentinel).toBeInTheDocument();
    });

    it('does not render infinite scroll sentinel when disabled', () => {
      const onLoadMore = vi.fn();
      render(
        <TransactionHistory
          transactions={mockTransactions}
          paginationMode="infinite"
          onLoadMore={onLoadMore}
          hasMore={true}
          enableInfiniteScroll={false}
        />
      );

      const sentinel = document.querySelector('.infinite-scroll-sentinel');
      expect(sentinel).not.toBeInTheDocument();
    });

    it('shows loading spinner in sentinel when fetching', () => {
      const onLoadMore = vi.fn();
      render(
        <TransactionHistory
          transactions={mockTransactions}
          paginationMode="infinite"
          onLoadMore={onLoadMore}
          hasMore={true}
          enableInfiniteScroll={true}
          isLoading={true}
        />
      );

      expect(screen.getByText('Loading more transactions...')).toBeInTheDocument();
    });
  });

  // New tests for default page size
  describe('default page size', () => {
    it('uses default page size of 20 when not specified', () => {
      render(<TransactionHistory transactions={mockTransactions} />);

      expect(screen.getByText(/Showing 1–20 of 25 transactions/)).toBeInTheDocument();
      expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
    });

    it('displays correct items with default page size', () => {
      render(<TransactionHistory transactions={mockTransactions} />);

      expect(screen.getByText('100 USDC')).toBeInTheDocument();
      expect(screen.getByText('119 USDC')).toBeInTheDocument();
      expect(screen.queryByText('120 USDC')).not.toBeInTheDocument();
    });

    it('handles next page with default page size', () => {
      render(<TransactionHistory transactions={mockTransactions} />);

      const nextButton = screen.getByLabelText('Next page');
      fireEvent.click(nextButton);

      expect(screen.getByText(/Showing 21–25 of 25 transactions/)).toBeInTheDocument();
      expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
      expect(screen.getByText('120 USDC')).toBeInTheDocument();
    });
  });

  // New tests for pagination mode switching
  describe('pagination mode switching', () => {
    it('shows page controls in page mode', () => {
      render(
        <TransactionHistory
          transactions={mockTransactions}
          paginationMode="page"
          pageSize={10}
        />
      );

      expect(screen.getByText('Previous')).toBeInTheDocument();
      expect(screen.getByText('Next')).toBeInTheDocument();
      expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    });

    it('shows load more button in infinite mode', () => {
      const onLoadMore = vi.fn();
      render(
        <TransactionHistory
          transactions={mockTransactions}
          paginationMode="infinite"
          onLoadMore={onLoadMore}
          hasMore={true}
        />
      );

      expect(screen.getByText('Load More')).toBeInTheDocument();
      expect(screen.queryByText('Previous')).not.toBeInTheDocument();
      expect(screen.queryByText('Next')).not.toBeInTheDocument();
    });

    it('hides pagination controls when not in page mode', () => {
      const onLoadMore = vi.fn();
      render(
        <TransactionHistory
          transactions={mockTransactions}
          paginationMode="infinite"
          onLoadMore={onLoadMore}
          hasMore={true}
        />
      );

      const nav = screen.queryByRole('navigation', { name: 'Pagination' });
      expect(nav).not.toBeInTheDocument();
    });
  });
});
