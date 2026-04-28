import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionStatusTracker, TransactionProgressStatus } from '../TransactionStatusTracker';

describe('TransactionStatusTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Basic Rendering', () => {
    it('renders with default title', () => {
      render(<TransactionStatusTracker currentStatus="initiated" enablePolling={false} />);
      expect(screen.getByText('Transaction Status')).toBeInTheDocument();
    });

    it('renders with custom title', () => {
      render(
        <TransactionStatusTracker
          currentStatus="initiated"
          title="Payment Progress"
          enablePolling={false}
        />
      );
      expect(screen.getByText('Payment Progress')).toBeInTheDocument();
    });

    it('renders all status steps', () => {
      render(<TransactionStatusTracker currentStatus="initiated" enablePolling={false} />);
      expect(screen.getByText('Initiated')).toBeInTheDocument();
      expect(screen.getByText('Submitted')).toBeInTheDocument();
      expect(screen.getByText('Processing')).toBeInTheDocument();
      expect(screen.getByText('Completed')).toBeInTheDocument();
      // Failed and Cancelled are only shown when they're the current status
      expect(screen.queryByText('Failed')).not.toBeInTheDocument();
      expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
    });

    it('shows cancelled status when current status is cancelled', () => {
      render(<TransactionStatusTracker currentStatus="cancelled" enablePolling={false} />);
      expect(screen.getByText('Cancelled')).toBeInTheDocument();
    });

    it('does not show cancelled status for other statuses', () => {
      render(<TransactionStatusTracker currentStatus="processing" enablePolling={false} />);
      expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
    });

    it('includes aria-live region for status announcements', () => {
      render(<TransactionStatusTracker currentStatus="initiated" enablePolling={false} />);
      const liveRegion = document.querySelector('[aria-live="polite"]');
      expect(liveRegion).toBeInTheDocument();
      expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    });
  });

  describe('Status Display', () => {
    it('highlights current status as active', () => {
      const { container } = render(
        <TransactionStatusTracker currentStatus="processing" enablePolling={false} />
      );
      const processingStep = container.querySelector('.transaction-tracker-step.active');
      expect(processingStep?.textContent).toBe('Processing');
    });

    it('marks previous steps as done', () => {
      const { container } = render(
        <TransactionStatusTracker currentStatus="processing" enablePolling={false} />
      );
      const doneSteps = container.querySelectorAll('.transaction-tracker-step.done');
      expect(doneSteps.length).toBe(2); // initiated and submitted
    });

    it('marks future steps appropriately', () => {
      const { container } = render(
        <TransactionStatusTracker currentStatus="submitted" enablePolling={false} />
      );
      const futureSteps = container.querySelectorAll('.transaction-tracker-step.future');
      expect(futureSteps.length).toBeGreaterThan(0);
    });

    it('applies failed styling when status is failed', () => {
      const { container } = render(
        <TransactionStatusTracker currentStatus="failed" enablePolling={false} />
      );
      // Failed step should be visible and have failed styling
      expect(screen.getByText('Failed')).toBeInTheDocument();
      const failedStep = container.querySelector('.transaction-tracker-step.failed');
      expect(failedStep).not.toBeNull();
      expect(failedStep?.textContent).toBe('Failed');
    });

    it('adds role="status" to the active step', () => {
      const { container } = render(
        <TransactionStatusTracker currentStatus="processing" enablePolling={false} />
      );
      const activeStep = container.querySelector('.transaction-tracker-step.active');
      expect(activeStep).toHaveAttribute('role', 'status');
    });

    it('does not add role="status" to non-active steps', () => {
      const { container } = render(
        <TransactionStatusTracker currentStatus="processing" enablePolling={false} />
      );
      const doneSteps = container.querySelectorAll('.transaction-tracker-step.done');
      doneSteps.forEach(step => {
        expect(step).not.toHaveAttribute('role', 'status');
      });
    });
  });

  describe('Accessibility', () => {
    it('announces status changes to screen readers', () => {
      const { rerender } = render(
        <TransactionStatusTracker currentStatus="initiated" enablePolling={false} />
      );
      const liveRegion = document.querySelector('[aria-live="polite"]');
      // Initially has the initiated status announcement
      expect(liveRegion?.textContent).toContain('Transaction initiated');

      rerender(
        <TransactionStatusTracker currentStatus="processing" enablePolling={false} />
      );
      expect(liveRegion?.textContent).toContain('Transaction is being processed');
    });

    it('has role="status" on aria-live region', () => {
      render(<TransactionStatusTracker currentStatus="initiated" enablePolling={false} />);
      const liveRegion = document.querySelector('[aria-live="polite"]');
      expect(liveRegion).toHaveAttribute('role', 'status');
    });

    it('announces completed status to screen readers', () => {
      const { rerender } = render(
        <TransactionStatusTracker currentStatus="processing" enablePolling={false} />
      );
      const liveRegion = document.querySelector('[aria-live="polite"]');
      
      rerender(
        <TransactionStatusTracker currentStatus="completed" enablePolling={false} />
      );
      expect(liveRegion?.textContent).toContain('Transaction completed successfully');
    });

    it('announces failed status to screen readers', () => {
      const { rerender } = render(
        <TransactionStatusTracker currentStatus="processing" enablePolling={false} />
      );
      const liveRegion = document.querySelector('[aria-live="polite"]');
      
      rerender(
        <TransactionStatusTracker currentStatus="failed" enablePolling={false} />
      );
      expect(liveRegion?.textContent).toContain('Transaction failed');
    });
  });
    it('calls onRefresh when refresh button is clicked', async () => {
      const user = userEvent.setup({ delay: null });
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={false}
        />
      );

      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      await user.click(refreshButton);

      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('shows refreshing state during refresh', async () => {
      const user = userEvent.setup({ delay: null });
      const onRefresh = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 100)));

      render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={false}
        />
      );

      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      await user.click(refreshButton);

      expect(screen.getByText('Refreshing...')).toBeInTheDocument();
    });

    it('updates last refresh timestamp after refresh', async () => {
      vi.useRealTimers();
      const user = userEvent.setup();
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={false}
        />
      );

      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      await user.click(refreshButton);

      await waitFor(() => {
        expect(screen.getByText(/Last refresh:/)).toBeInTheDocument();
      }, { timeout: 3000 });
      
      vi.useFakeTimers();
    });
  });

  describe('Polling Functionality', () => {
    it('starts polling when enablePolling is true', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={5000}
        />
      );

      expect(onRefresh).not.toHaveBeenCalled();

      vi.advanceTimersByTime(5000);

      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('polls at the specified interval', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={3000}
        />
      );

      vi.advanceTimersByTime(3000);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(3000);
      expect(onRefresh).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(3000);
      expect(onRefresh).toHaveBeenCalledTimes(3);
    });

    it('does not poll when enablePolling is false', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={false}
          pollingInterval={5000}
        />
      );

      vi.advanceTimersByTime(10000);

      expect(onRefresh).not.toHaveBeenCalled();
    });

    it('stops polling when status reaches completed', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      const { rerender } = render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={5000}
        />
      );

      vi.advanceTimersByTime(5000);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      // Update to completed status
      rerender(
        <TransactionStatusTracker
          currentStatus="completed"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={5000}
        />
      );

      // Advance time and verify no more polling
      vi.advanceTimersByTime(10000);
      expect(onRefresh).toHaveBeenCalledTimes(1); // Still only 1 call
    });

    it('stops polling when status reaches failed', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      const { rerender } = render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={5000}
        />
      );

      vi.advanceTimersByTime(5000);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      // Update to failed status
      rerender(
        <TransactionStatusTracker
          currentStatus="failed"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={5000}
        />
      );

      // Advance time and verify no more polling
      vi.advanceTimersByTime(10000);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('stops polling when status reaches cancelled', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      const { rerender } = render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={5000}
        />
      );

      vi.advanceTimersByTime(5000);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      // Update to cancelled status
      rerender(
        <TransactionStatusTracker
          currentStatus="cancelled"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={5000}
        />
      );

      // Advance time and verify no more polling
      vi.advanceTimersByTime(10000);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('does not start polling if initial status is terminal', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      render(
        <TransactionStatusTracker
          currentStatus="completed"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={5000}
        />
      );

      vi.advanceTimersByTime(10000);

      expect(onRefresh).not.toHaveBeenCalled();
    });
  });

  describe('API Polling', () => {
    it('fetches status from API when transactionId is provided', async () => {
      vi.useRealTimers();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'completed' }),
      });
      global.fetch = mockFetch;

      render(
        <TransactionStatusTracker
          transactionId="tx_123"
          currentStatus="processing"
          enablePolling={true}
          pollingInterval={100}
        />
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/remittance/tx_123');
      }, { timeout: 3000 });
      
      vi.useFakeTimers();
    });

    it('calls onStatusUpdate when status changes from API', async () => {
      vi.useRealTimers();
      const onStatusUpdate = vi.fn();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'completed' }),
      });
      global.fetch = mockFetch;

      render(
        <TransactionStatusTracker
          transactionId="tx_123"
          currentStatus="processing"
          onStatusUpdate={onStatusUpdate}
          enablePolling={true}
          pollingInterval={100}
        />
      );

      await waitFor(() => {
        expect(onStatusUpdate).toHaveBeenCalledWith('completed');
      }, { timeout: 3000 });
      
      vi.useFakeTimers();
    });

    it('handles API errors gracefully', async () => {
      vi.useRealTimers();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;

      render(
        <TransactionStatusTracker
          transactionId="tx_123"
          currentStatus="processing"
          enablePolling={true}
          pollingInterval={100}
        />
      );

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalled();
      }, { timeout: 3000 });

      consoleError.mockRestore();
      vi.useFakeTimers();
    });

    it('does not update status if API returns same status', async () => {
      vi.useRealTimers();
      const onStatusUpdate = vi.fn();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'processing' }),
      });
      global.fetch = mockFetch;

      render(
        <TransactionStatusTracker
          transactionId="tx_123"
          currentStatus="processing"
          onStatusUpdate={onStatusUpdate}
          enablePolling={true}
          pollingInterval={100}
        />
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      }, { timeout: 3000 });

      expect(onStatusUpdate).not.toHaveBeenCalled();
      vi.useFakeTimers();
    });
  });

  describe('Cleanup', () => {
    it('cleans up polling interval on unmount', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      const { unmount } = render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={5000}
        />
      );

      unmount();

      vi.advanceTimersByTime(10000);

      expect(onRefresh).not.toHaveBeenCalled();
    });

    it('cleans up polling when enablePolling changes to false', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      const { rerender } = render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={5000}
        />
      );

      vi.advanceTimersByTime(5000);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      rerender(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={false}
          pollingInterval={5000}
        />
      );

      vi.advanceTimersByTime(10000);
      expect(onRefresh).toHaveBeenCalledTimes(1); // No additional calls
    });
  });

  describe('Polling Interval Configuration', () => {
    it('uses default polling interval of 5000ms', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={true}
        />
      );

      vi.advanceTimersByTime(4999);
      expect(onRefresh).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('respects custom polling interval', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={2000}
        />
      );

      vi.advanceTimersByTime(2000);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2000);
      expect(onRefresh).toHaveBeenCalledTimes(2);
    });

    it('updates polling interval when prop changes', () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      const { rerender, unmount } = render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={2000}
        />
      );

      vi.advanceTimersByTime(2000);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2000);
      expect(onRefresh).toHaveBeenCalledTimes(2);

      unmount();
    });
  });

  describe('Auto-updating Indicator', () => {
    it('shows auto-updating indicator when polling is active', async () => {
      vi.useRealTimers();
      const user = userEvent.setup();
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      render(
        <TransactionStatusTracker
          currentStatus="processing"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={5000}
        />
      );

      // Trigger a refresh to show the timestamp
      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      await user.click(refreshButton);

      await waitFor(() => {
        expect(screen.getByText(/auto-updating/)).toBeInTheDocument();
      }, { timeout: 3000 });
      
      vi.useFakeTimers();
    });

    it('does not show auto-updating indicator when polling is stopped', async () => {
      vi.useRealTimers();
      const user = userEvent.setup();
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      render(
        <TransactionStatusTracker
          currentStatus="completed"
          onRefresh={onRefresh}
          enablePolling={true}
          pollingInterval={5000}
        />
      );

      // Trigger a refresh to show the timestamp
      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      await user.click(refreshButton);

      await waitFor(() => {
        expect(screen.getByText(/Last refresh:/)).toBeInTheDocument();
      }, { timeout: 3000 });

      expect(screen.queryByText(/auto-updating/)).not.toBeInTheDocument();
      vi.useFakeTimers();
    });
  });
});
