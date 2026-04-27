import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import type { TransactionProgressStatus } from './TransactionStatusTracker';
import './TransactionHistory.css';

type HistoryViewMode = 'table' | 'card';

export interface TransactionHistoryItem {
  id: string;
  amount: number;
  asset: string;
  recipient: string;
  status: TransactionProgressStatus;
  timestamp: string;
  memo?: string;
  details?: Record<string, string | number>;
}

interface TransactionHistoryProps {
  transactions: TransactionHistoryItem[];
  defaultView?: HistoryViewMode;
  title?: string;
  pageSize?: number;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  onLoadMore?: () => void;
  isLoading?: boolean;
}

// ── URL param helpers ────────────────────────────────────────────────────────

function getSearchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function pushSearchParams(params: URLSearchParams): void {
  const url = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, '', url);
}

// ── Debounce hook ────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function formatAmount(amount: number, asset: string): string {
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${asset}`;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function downloadJSON(tx: TransactionHistoryItem): void {
  const receipt = {
    transactionId: tx.id,
    amount: tx.amount,
    asset: tx.asset,
    recipient: tx.recipient,
    status: tx.status,
    timestamp: tx.timestamp,
    ...(tx.memo ? { memo: tx.memo } : {}),
    ...(tx.details ? { details: tx.details } : {}),
    downloadedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `receipt-${tx.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadPDF(tx: TransactionHistoryItem): void {
  const rows = [
    ['Transaction ID', tx.id],
    ['Amount', formatAmount(tx.amount, tx.asset)],
    ['Asset', tx.asset],
    ['Recipient', tx.recipient],
    ['Status', tx.status],
    ['Timestamp', formatTimestamp(tx.timestamp)],
    ...(tx.memo ? [['Memo', tx.memo]] : []),
    ...Object.entries(tx.details || {}).map(([k, v]) => [k, String(v)]),
    ['Downloaded At', new Date().toLocaleString()],
  ];

  const tableRows = rows
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
    .join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Receipt ${tx.id}</title>
<style>
  body { font-family: sans-serif; padding: 32px; color: #111; }
  h1 { font-size: 1.4em; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #ddd; }
  th { width: 40%; color: #555; font-weight: 600; }
</style>
</head><body>
<h1>Transaction Receipt</h1>
<table>${tableRows}</table>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
  win.close();
}

function ReceiptDownloadButtons({ tx }: { tx: TransactionHistoryItem }) {
  return (
    <span className="receipt-buttons">
      <button
        type="button"
        className="receipt-btn"
        onClick={() => downloadJSON(tx)}
        aria-label={`Download JSON receipt for transaction ${tx.id}`}
        title="Download JSON"
      >
        JSON
      </button>
      <button
        type="button"
        className="receipt-btn"
        onClick={() => downloadPDF(tx)}
        aria-label={`Download PDF receipt for transaction ${tx.id}`}
        title="Download PDF"
      >
        PDF
      </button>
    </span>
  );
}

export const TransactionHistory: React.FC<TransactionHistoryProps> = ({
  transactions,
  defaultView = 'table',
  title = 'Transaction History',
  pageSize = 20,
  currentPage: controlledPage,
  onPageChange,
  onLoadMore,
  isLoading = false,
}) => {
  // Initialise filter state from URL params
  const initialParams = getSearchParams();

  const [view, setView] = useState<HistoryViewMode>(defaultView);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [uncontrolledPage, setUncontrolledPage] = useState(1);

  const [searchText, setSearchText] = useState(initialParams.get('q') ?? '');
  const [filterStatus, setFilterStatus] = useState(initialParams.get('status') ?? '');
  const [filterAsset, setFilterAsset] = useState(initialParams.get('asset') ?? '');
  const [filterDateFrom, setFilterDateFrom] = useState(initialParams.get('from') ?? '');
  const [filterDateTo, setFilterDateTo] = useState(initialParams.get('to') ?? '');

  const debouncedSearch = useDebounce(searchText);

  // Sync filter state → URL params
  useEffect(() => {
    const params = getSearchParams();
    const set = (key: string, val: string) =>
      val ? params.set(key, val) : params.delete(key);
    set('q', debouncedSearch);
    set('status', filterStatus);
    set('asset', filterAsset);
    set('from', filterDateFrom);
    set('to', filterDateTo);
    pushSearchParams(params);
  }, [debouncedSearch, filterStatus, filterAsset, filterDateFrom, filterDateTo]);

  const isControlled = controlledPage !== undefined;
  const currentPage = isControlled ? controlledPage : uncontrolledPage;

  // Derive unique status/asset options from data
  const statusOptions = useMemo(
    () => Array.from(new Set(transactions.map(t => t.status))).sort(),
    [transactions],
  );
  const assetOptions = useMemo(
    () => Array.from(new Set(transactions.map(t => t.asset))).sort(),
    [transactions],
  );

  // Apply filters
  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    const fromMs = filterDateFrom ? new Date(filterDateFrom).getTime() : null;
    const toMs = filterDateTo ? new Date(filterDateTo + 'T23:59:59').getTime() : null;

    return transactions.filter(t => {
      if (q && !t.id.toLowerCase().includes(q) && !t.recipient.toLowerCase().includes(q)) {
        return false;
      }
      if (filterStatus && t.status !== filterStatus) return false;
      if (filterAsset && t.asset !== filterAsset) return false;
      const ts = new Date(t.timestamp).getTime();
      if (fromMs !== null && ts < fromMs) return false;
      if (toMs !== null && ts > toMs) return false;
      return true;
    });
  }, [transactions, debouncedSearch, filterStatus, filterAsset, filterDateFrom, filterDateTo]);

  const paginationData = useMemo(() => {
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    return {
      items: filtered.slice(startIdx, endIdx),
      totalPages,
      totalRecords: total,
      startRecord: total === 0 ? 0 : startIdx + 1,
      endRecord: Math.min(endIdx, total),
    };
  }, [filtered, pageSize, currentPage]);

  const handlePageChange = (newPage: number) => {
    if (isControlled && onPageChange) {
      onPageChange(newPage);
    } else {
      setUncontrolledPage(newPage);
    }
  };

  // Reset to page 1 when filters change
  useEffect(() => {
    if (!isControlled) setUncontrolledPage(1);
  }, [debouncedSearch, filterStatus, filterAsset, filterDateFrom, filterDateTo, isControlled]);

  // Reset to page 1 when transactions change
  useEffect(() => {
    if (!isControlled) setUncontrolledPage(1);
  }, [transactions, isControlled]);

  const toggleExpanded = (id: string) =>
    setExpandedId(current => (current === id ? null : id));

  const clearFilters = () => {
    setSearchText('');
    setFilterStatus('');
    setFilterAsset('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const hasActiveFilters =
    searchText || filterStatus || filterAsset || filterDateFrom || filterDateTo;

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

      {/* ── Search & Filter bar ── */}
      <div className="history-filters" role="search" aria-label="Filter transactions">
        <label className="history-filter-item">
          <span className="filter-label">Search</span>
          <input
            type="search"
            className="history-search-input"
            placeholder="Transaction ID or recipient…"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            aria-label="Search by transaction ID or recipient address"
          />
        </label>

        <label className="history-filter-item">
          <span className="filter-label">Status</span>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {statusOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <label className="history-filter-item">
          <span className="filter-label">Asset</span>
          <select
            value={filterAsset}
            onChange={e => setFilterAsset(e.target.value)}
            aria-label="Filter by asset type"
          >
            <option value="">All assets</option>
            {assetOptions.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>

        <label className="history-filter-item">
          <span className="filter-label">From</span>
          <input
            type="date"
            value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)}
            aria-label="Filter from date"
          />
        </label>

        <label className="history-filter-item">
          <span className="filter-label">To</span>
          <input
            type="date"
            value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)}
            aria-label="Filter to date"
          />
        </label>

        {hasActiveFilters && (
          <button type="button" className="history-clear-filters" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {isLoading && (
        <div className="history-loading" aria-live="polite">
          <div className="history-loading-spinner" />
          <span>Loading more transactions...</span>
        </div>
      )}

      {filtered.length === 0 && !isLoading && (
        <p className="history-empty">
          {hasActiveFilters ? 'No transactions match the current filters.' : 'No transactions yet.'}
        </p>
      )}

      {filtered.length > 0 && (
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
                    <th>Receipt</th>
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
                          <td><ReceiptDownloadButtons tx={transaction} /></td>
                        </tr>
                        {isExpanded && (
                          <tr className="history-details-row">
                            <td colSpan={7}>
                              <dl className="history-details">
                                <div key={`${transaction.id}-id`}>
                                  <dt>Transaction ID</dt>
                                  <dd>{transaction.id}</dd>
                                </div>
                                {transaction.memo && (
                                  <div key={`${transaction.id}-memo`}>
                                    <dt>Memo</dt>
                                    <dd>{transaction.memo}</dd>
                                  </div>
                                )}
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
                    <ReceiptDownloadButtons tx={transaction} />
                    {isExpanded && (
                      <dl className="history-details">
                        <div key={`${transaction.id}-id`}>
                          <dt>Transaction ID</dt>
                          <dd>{transaction.id}</dd>
                        </div>
                        {transaction.memo && (
                          <div key={`${transaction.id}-memo`}>
                            <dt>Memo</dt>
                            <dd>{transaction.memo}</dd>
                          </div>
                        )}
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
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1 || isLoading}
              aria-label="Previous page"
            >
              Previous
            </button>
            <span className="pagination-info" aria-live="polite">
              Page {currentPage} of {paginationData.totalPages}
            </span>
            <button
              type="button"
              onClick={() =>
                currentPage < paginationData.totalPages
                  ? handlePageChange(currentPage + 1)
                  : onLoadMore?.()
              }
              disabled={currentPage === paginationData.totalPages && !onLoadMore || isLoading}
              aria-label="Next page"
            >
              {onLoadMore && currentPage === paginationData.totalPages ? 'Load More' : 'Next'}
            </button>
          </nav>
        </>
      )}
    </section>
  );
};

