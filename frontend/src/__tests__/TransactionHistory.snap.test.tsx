import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TransactionHistory, Transaction } from '../components/TransactionHistory';

const baseTx: Transaction = {
  id: 'TX-001',
  amount: 250.0,
  currency: 'USDC',
  recipient: 'GABC1234DEF5678HIJK9012LMNO3456PQRS7890TUVW1234XYZ5678ABCD',
  corridor: 'USD → KES',
  status: 'completed',
  createdAt: '2024-06-01T10:00:00Z',
  fee: 6.25,
};

const transactions: Transaction[] = [
  baseTx,
  {
    ...baseTx,
    id: 'TX-002',
    amount: 100.0,
    status: 'pending',
    fee: 2.5,
    createdAt: '2024-06-02T14:30:00Z',
  },
  {
    ...baseTx,
    id: 'TX-003',
    amount: 500.0,
    status: 'failed',
    fee: 0,
    corridor: 'USD → NGN',
    createdAt: '2024-06-03T08:15:00Z',
  },
  {
    ...baseTx,
    id: 'TX-004',
    amount: 75.5,
    status: 'cancelled',
    fee: 0,
    corridor: 'USD → GHS',
    createdAt: '2024-06-04T12:00:00Z',
  },
];

describe('TransactionHistory snapshots', () => {
  it('renders with a populated list of transactions', () => {
    const { container } = render(
      <TransactionHistory
        transactions={transactions}
        onViewDetails={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(container).toMatchSnapshot();
  });

  it('renders empty state when no transactions', () => {
    const { container } = render(<TransactionHistory transactions={[]} />);
    expect(container).toMatchSnapshot();
  });

  it('renders loading skeleton', () => {
    const { container } = render(<TransactionHistory isLoading />);
    expect(container).toMatchSnapshot();
  });

  it('renders a single completed transaction', () => {
    const { container } = render(
      <TransactionHistory transactions={[baseTx]} />,
    );
    expect(container).toMatchSnapshot();
  });

  it('renders a failed transaction with retry button', () => {
    const failedTx: Transaction = { ...baseTx, status: 'failed', fee: 0 };
    const { container } = render(
      <TransactionHistory
        transactions={[failedTx]}
        onRetry={vi.fn()}
        onViewDetails={vi.fn()}
      />,
    );
    expect(container).toMatchSnapshot();
  });
});
