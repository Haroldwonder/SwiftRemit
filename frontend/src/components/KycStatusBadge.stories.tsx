import type { Meta, StoryObj } from '@storybook/react';
import { KycStatusBadge } from './KycStatusBadge';

const meta: Meta<typeof KycStatusBadge> = {
  title: 'Components/KycStatusBadge',
  component: KycStatusBadge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    userId: { control: 'text' },
    showDetails: { control: 'boolean' },
    pollingIntervalMs: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Approved KYC – polling immediately returns approved */
export const Approved: Story = {
  args: {
    userId: 'user-approved-001',
    apiUrl: 'http://localhost:3000',
    showDetails: true,
    pollingIntervalMs: 0,
  },
};

/** Pending KYC verification */
export const Pending: Story = {
  args: {
    userId: 'user-pending-001',
    apiUrl: 'http://localhost:3000',
    showDetails: true,
    pollingIntervalMs: 0,
  },
};

/** Rejected KYC */
export const Rejected: Story = {
  args: {
    userId: 'user-rejected-001',
    apiUrl: 'http://localhost:3000',
    showDetails: false,
    pollingIntervalMs: 0,
  },
};

/** Expired KYC */
export const Expired: Story = {
  args: {
    userId: 'user-expired-001',
    apiUrl: 'http://localhost:3000',
    showDetails: true,
    pollingIntervalMs: 0,
  },
};

/** Loading state – no apiUrl means badge will show loading */
export const Loading: Story = {
  args: {
    userId: 'user-loading',
    showDetails: true,
    pollingIntervalMs: 0,
  },
};
