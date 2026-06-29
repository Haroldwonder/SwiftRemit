import type { Meta, StoryObj } from '@storybook/react';
import { TransactionHistory, Transaction } from './index';

const sampleTransactions: Transaction[] = [
  {
    id: 'TX-001',
    amount: 250.0,
    currency: 'USDC',
    recipient: 'GABC1234DEF5678',
    corridor: 'USD → KES',
    status: 'completed',
    createdAt: '2024-06-01T10:00:00Z',
    fee: 6.25,
  },
  {
    id: 'TX-002',
    amount: 100.0,
    currency: 'USDC',
    recipient: 'GXYZ9876WVU5432',
    corridor: 'USD → NGN',
    status: 'pending',
    createdAt: '2024-06-02T14:30:00Z',
    fee: 2.5,
  },
  {
    id: 'TX-003',
    amount: 500.0,
    currency: 'USDC',
    recipient: 'GQRS1111TTT2222',
    corridor: 'USD → GHS',
    status: 'failed',
    createdAt: '2024-06-03T08:15:00Z',
    fee: 0,
  },
];

const meta: Meta<typeof TransactionHistory> = {
  title: 'Components/TransactionHistory',
  component: TransactionHistory,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    onRetry: { action: 'retry' },
    onViewDetails: { action: 'viewDetails' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTransactions: Story = {
  args: {
    transactions: sampleTransactions,
  },
};

export const Empty: Story = {
  args: {
    transactions: [],
  },
};

export const Loading: Story = {
  args: {
    isLoading: true,
  },
};
