import React from 'react';

export type TxStatus = 'pending' | 'completed' | 'cancelled' | 'failed';

export interface Transaction {
  id: string;
  amount: number;
  currency: string;
  recipient: string;
  corridor: string;
  status: TxStatus;
  createdAt: string;
  fee: number;
}

export interface TransactionHistoryProps {
  transactions?: Transaction[];
  isLoading?: boolean;
  onRetry?: (txId: string) => void;
  onViewDetails?: (txId: string) => void;
}

const STATUS_LABELS: Record<TxStatus, string> = {
  pending: 'Pending',
  completed: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

export function TransactionHistory({
  transactions = [],
  isLoading = false,
  onRetry,
  onViewDetails,
}: TransactionHistoryProps) {
  if (isLoading) {
    return (
      <div
        className="transaction-history transaction-history--loading"
        data-testid="tx-history-loading"
        aria-busy="true"
        aria-label="Loading transactions"
      >
        <div className="skeleton-row" />
        <div className="skeleton-row" />
        <div className="skeleton-row" />
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div
        className="transaction-history transaction-history--empty"
        data-testid="tx-history-empty"
      >
        <p>No transactions yet. Send money to get started.</p>
      </div>
    );
  }

  return (
    <div className="transaction-history" data-testid="tx-history">
      <h2>Transaction History</h2>
      <table aria-label="Transactions">
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Amount</th>
            <th scope="col">Corridor</th>
            <th scope="col">Recipient</th>
            <th scope="col">Status</th>
            <th scope="col">Date</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr key={tx.id} data-testid={`tx-row-${tx.id}`}>
              <td className="tx-id">{tx.id}</td>
              <td className="tx-amount">
                {tx.amount.toFixed(2)} {tx.currency}
                {tx.fee > 0 && (
                  <span className="tx-fee"> (fee: {tx.fee.toFixed(2)})</span>
                )}
              </td>
              <td className="tx-corridor">{tx.corridor}</td>
              <td className="tx-recipient" title={tx.recipient}>
                {tx.recipient.slice(0, 8)}…
              </td>
              <td className="tx-status">
                <span
                  className={`status-badge status-badge--${tx.status}`}
                  data-testid={`status-${tx.id}`}
                >
                  {STATUS_LABELS[tx.status]}
                </span>
              </td>
              <td className="tx-date">
                {new Date(tx.createdAt).toLocaleDateString()}
              </td>
              <td className="tx-actions">
                <button
                  onClick={() => onViewDetails?.(tx.id)}
                  className="btn-link"
                  aria-label={`View details for ${tx.id}`}
                >
                  Details
                </button>
                {tx.status === 'failed' && (
                  <button
                    onClick={() => onRetry?.(tx.id)}
                    className="btn-link btn-retry"
                    aria-label={`Retry ${tx.id}`}
                  >
                    Retry
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
