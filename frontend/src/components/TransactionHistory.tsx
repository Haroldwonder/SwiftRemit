import React, { useMemo, useState } from 'react';
import { TransactionProgressStatus } from './TransactionStatusTracker';
import './TransactionHistory.css';

type HistoryViewMode = 'table' | 'card';

export interface TransactionHistoryItem {
  id: string;
  amount: number;
  asset: string;
  recipient: string;
  status: TransactionProgressStatus;
  timestamp: string;
  details?: Record<string, string | number>;
}

interface TransactionHistoryProps {
  transactions: TransactionHistoryItem[];
  defaultView?: HistoryViewMode;
  title?: string;
  pageSize?: number;
  currentPage?: number;
  onPageChange?: (page: number) => void;
}

function formatAmount(amount: number, asset: string): string {
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${asset}`;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export const TransactionHistory: React.FC<TransactionHistoryProps> = ({
  transactions,
  defaultView = 'table',
  title = 'Transaction History',
  pageSize = 10,
  currentPage: controlledPage,
  onPageChange,
}) => {
  const [view, setView] = useState<HistoryViewMode>(defaultView);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [uncontrolledPage, setUncontrolledPage] = useState(1);

  const isControlled = controlledPage !== undefined;
  const currentPage = isControlled ? controlledPage : uncontrolledPage;

  const hasTransactions = useMemo(() => transactions.length > 0, [transactions]);

  const paginationData = useMemo(() => {
    const total = transactions.length;
    const totalPages = Math.ceil(total / pageSize);
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const paginatedItems = transactions.slice(startIdx, endIdx);

    return {
      items: paginatedItems,
      totalPages,
      totalRecords: total,
      startRecord: total === 0 ? 0 : startIdx + 1,
      endRecord: Math.min(endIdx, total),
    };
  }, [transactions, pageSize, currentPage]);

  const handlePageChange = (newPage: number) => {
    if (isControlled && onPageChange) {
      onPageChange(newPage);
    } else {
      setUncontrolledPage(newPage);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      handlePageChange(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < paginationData.totalPages) {
      handlePageChange(currentPage + 1);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  // Reset to page 1 when transactions change
  React.useEffect(() => {
    if (!isControlled) {
      setUncontrolledPage(1);
    }
  }, [transactions, isControlled]);

  return (
    <section className="transaction-history" aria-label="Transaction history">
      <header className="transaction-history-header">
        <h2>{title}</h2>
        <div className="history-view-controls" role="tablist" aria-label="History view mode">
          <button
            type="button"
            className={view === 'table' ? 'active' : ''}
            onClick={() => setView('table')}
            role="tab"
            aria-selected={view === 'table'}
          >
            Table
          </button>
          <button
            type="button"
            className={view === 'card' ? 'active' : ''}
            onClick={() => setView('card')}
            role="tab"
            aria-selected={view === 'card'}
          >
            Cards
          </button>
        </div>
      </header>

      {!hasTransactions && <p className="history-empty">No transactions yet.</p>}

      {hasTransactions && (
        <>
          <div className="history-pagination-info" aria-live="polite" aria-atomic="true">
            Showing {paginationData.startRecord}–{paginationData.endRecord} of{' '}
            {paginationData.totalRecords} transactions
          </div>

          {view === 'table' && (
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Amount</th>
                    <th>Asset</th>
                    <th>Recipient</th>
                    <th>Status</th>
                    <th>Timestamp</th>
                    <th aria-label="Expand details column" />
                  </tr>
                </thead>
                <tbody>
                  {paginationData.items.map((transaction) => {
                    const isExpanded = expandedId === transaction.id;
                    return (
                      <React.Fragment key={transaction.id}>
                        <tr>
                          <td>{formatAmount(transaction.amount, transaction.asset)}</td>
                          <td>{transaction.asset}</td>
                          <td className="history-recipient">{transaction.recipient}</td>
                          <td>
                            <span className={`history-status status-${transaction.status}`}>
                              {transaction.status}
                            </span>
                          </td>
                          <td>{formatTimestamp(transaction.timestamp)}</td>
                          <td>
                            <button
                              type="button"
                              className="history-expand"
                              onClick={() => toggleExpanded(transaction.id)}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? 'Hide' : 'Expand'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="history-details-row">
                            <td colSpan={6}>
                              <dl className="history-details">
                                {Object.entries(transaction.details || {}).map(([key, value]) => (
                                  <div key={`${transaction.id}-${key}`}>
                                    <dt>{key}</dt>
                                    <dd>{value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {view === 'card' && (
            <div className="history-cards">
              {paginationData.items.map((transaction) => {
                const isExpanded = expandedId === transaction.id;
                return (
                  <article key={transaction.id} className="history-card">
                    <div className="history-card-top">
                      <p>{formatAmount(transaction.amount, transaction.asset)}</p>
                      <span className={`history-status status-${transaction.status}`}>
                        {transaction.status}
                      </span>
                    </div>
                    <dl className="history-card-grid">
                      <div>
                        <dt>Asset</dt>
                        <dd>{transaction.asset}</dd>
                      </div>
                      <div>
                        <dt>Recipient</dt>
                        <dd className="history-recipient">{transaction.recipient}</dd>
                      </div>
                      <div>
                        <dt>Timestamp</dt>
                        <dd>{formatTimestamp(transaction.timestamp)}</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      className="history-expand"
                      onClick={() => toggleExpanded(transaction.id)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? 'Hide details' : 'Expand details'}
                    </button>
                    {isExpanded && (
                      <dl className="history-details">
                        {Object.entries(transaction.details || {}).map(([key, value]) => (
                          <div key={`${transaction.id}-${key}`}>
                            <dt>{key}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          <nav className="history-pagination" aria-label="Pagination">
            <button
              type="button"
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              aria-label="Previous page"
            >
              Previous
            </button>
            <span className="pagination-info" aria-live="polite">
              Page {currentPage} of {paginationData.totalPages}
            </span>
            <button
              type="button"
              onClick={handleNextPage}
              disabled={currentPage === paginationData.totalPages}
              aria-label="Next page"
            >
              Next
            </button>
          </nav>
        </>
      )}
    </section>
  );
};
