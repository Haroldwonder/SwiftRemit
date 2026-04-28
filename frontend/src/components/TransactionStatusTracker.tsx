import React, { useEffect, useMemo, useState, useRef } from 'react';
import './TransactionStatusTracker.css';

export type TransactionProgressStatus =
  | 'initiated'
  | 'submitted'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface TransactionStatusTrackerProps {
  transactionId?: string;
  currentStatus: TransactionProgressStatus;
  onRefresh?: () => Promise<void> | void;
  onStatusUpdate?: (status: TransactionProgressStatus) => void;
  pollingInterval?: number;
  enablePolling?: boolean;
  title?: string;
}

const TRACKER_STEPS: Array<{ key: TransactionProgressStatus; label: string }> = [
  { key: 'initiated', label: 'Initiated' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'processing', label: 'Processing' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const TERMINAL_STATES: TransactionProgressStatus[] = ['completed', 'failed', 'cancelled'];

const isTerminalState = (status: TransactionProgressStatus): boolean => {
  return TERMINAL_STATES.includes(status);
};

// Generate descriptive status announcement messages
const getStatusAnnouncementMessage = (status: TransactionProgressStatus): string => {
  const statusMessages: Record<TransactionProgressStatus, string> = {
    initiated: 'Transaction initiated. Processing has started.',
    submitted: 'Transaction submitted to the network.',
    processing: 'Transaction is being processed. Please wait.',
    completed: 'Transaction completed successfully.',
    failed: 'Transaction failed. Please check the error details.',
    cancelled: 'Transaction was cancelled.',
  };
  return statusMessages[status];
};

export const TransactionStatusTracker: React.FC<TransactionStatusTrackerProps> = ({
  transactionId,
  currentStatus,
  onRefresh,
  onStatusUpdate,
  pollingInterval = 5000,
  enablePolling = true,
  title = 'Transaction Status',
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [localStatus, setLocalStatus] = useState<TransactionProgressStatus>(currentStatus);
  const [statusAnnouncement, setStatusAnnouncement] = useState<string>('');
  const [previousStatus, setPreviousStatus] = useState<TransactionProgressStatus | null>(null);
  const [announcementKey, setAnnouncementKey] = useState<number>(0);
  const pollingTimerRef = useRef<number | null>(null);
  const announcedStatusRef = useRef<TransactionProgressStatus | null>(null);

  const activeIndex = useMemo(() => {
    return TRACKER_STEPS.findIndex((step) => step.key === localStatus);
  }, [localStatus]);

  const fetchTransactionStatus = async (): Promise<TransactionProgressStatus | null> => {
    if (!transactionId) return null;

    try {
      const response = await fetch(`/api/remittance/${transactionId}`);
      if (!response.ok) {
        console.error('Failed to fetch transaction status:', response.statusText);
        return null;
      }

      const data = await response.json();
      return data.status as TransactionProgressStatus;
    } catch (error) {
      console.error('Error fetching transaction status:', error);
      return null;
    }
  };

  const refresh = async () => {
    if (isRefreshing) return;
    
    setIsRefreshing(true);
    try {
      // If custom refresh handler is provided, use it
      if (onRefresh) {
        await onRefresh();
      } else if (transactionId) {
        // Otherwise, fetch from API
        const newStatus = await fetchTransactionStatus();
        if (newStatus && newStatus !== localStatus) {
          setLocalStatus(newStatus);
          onStatusUpdate?.(newStatus);
        }
      }
      setLastRefreshedAt(new Date());
    } finally {
      setIsRefreshing(false);
    }
  };

  const stopPolling = () => {
    if (pollingTimerRef.current !== null) {
      window.clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  };

  const startPolling = () => {
    stopPolling();

    if (!enablePolling || isTerminalState(localStatus)) {
      return;
    }

    pollingTimerRef.current = window.setInterval(() => {
      refresh();
    }, pollingInterval);
  };

  // Update local status when prop changes
  useEffect(() => {
    setLocalStatus(currentStatus);
  }, [currentStatus]);

  // Announce status changes to screen readers
  // Only announce if status has actually changed
  useEffect(() => {
    if (localStatus !== announcedStatusRef.current) {
      const message = getStatusAnnouncementMessage(localStatus);
      setStatusAnnouncement(message);
      // Force re-render of aria-live region by changing key
      setAnnouncementKey(prev => prev + 1);
      announcedStatusRef.current = localStatus;
    }
    setPreviousStatus(localStatus);
  }, [localStatus]);

  // Start/stop polling based on status and configuration
  useEffect(() => {
    if (enablePolling && !isTerminalState(localStatus)) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => {
      stopPolling();
    };
  }, [enablePolling, localStatus, pollingInterval, transactionId]);

  // Stop polling when terminal state is reached
  useEffect(() => {
    if (isTerminalState(localStatus)) {
      stopPolling();
    }
  }, [localStatus]);

  const isPollingActive = enablePolling && !isTerminalState(localStatus);

  return (
    <section className="transaction-tracker" aria-label={title}>
      {/* Screen reader announcements - aria-live region */}
      <div 
        key={announcementKey}
        aria-live="polite" 
        aria-atomic="true" 
        className="sr-only"
        role="status"
      >
        {statusAnnouncement}
      </div>

      <header className="transaction-tracker-header">
        <h2>{title}</h2>
        <div className="transaction-tracker-refresh">
          {lastRefreshedAt && (
            <span className="tracker-refresh-meta" aria-live="off">
              Last refresh: {lastRefreshedAt.toLocaleTimeString()}
              {isPollingActive && ' (auto-updating)'}
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            className="tracker-refresh-button"
            disabled={isRefreshing}
            aria-label="Manually refresh transaction status"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      <ol className="transaction-tracker-steps">
        {TRACKER_STEPS.filter(step => 
          // Show cancelled and failed only if they're the current status
          (step.key !== 'cancelled' && step.key !== 'failed') || 
          localStatus === step.key
        ).map((step, index) => {
          const isFailed = step.key === 'failed' && localStatus === 'failed';
          const isCancelled = step.key === 'cancelled' && localStatus === 'cancelled';
          const isActive = step.key === localStatus && !isFailed && !isCancelled;
          const isDone = index < activeIndex && !['failed', 'cancelled'].includes(localStatus);
          const isFuture = index > activeIndex && !['failed', 'cancelled'].includes(localStatus);
          
          let stepClass = '';
          if (isFailed) stepClass = 'failed';
          else if (isCancelled) stepClass = 'cancelled';
          else if (isActive) stepClass = 'active';
          else if (isDone) stepClass = 'done';
          else if (isFuture) stepClass = 'future';

          return (
            <li 
              className={`transaction-tracker-step ${stepClass}`} 
              key={step.key}
              role={isActive ? "status" : undefined}
              aria-current={isActive ? "step" : undefined}
            >
              <span className="step-marker" aria-hidden="true" />
              <span className="step-label">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
