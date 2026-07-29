import type { Meta, StoryObj } from '@storybook/react';
import { FeePreview } from './FeePreview';

const meta: Meta<typeof FeePreview> = {
  title: 'Components/FeePreview',
  component: FeePreview,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    amount: { control: { type: 'number', min: 0, step: 10 } },
    corridor: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Default – empty (no amount or corridor) */
export const Empty: Story = {
  args: {
    amount: 0,
    corridor: '',
  },
};

/** Loading – has values but service is slow (the component shows a spinner) */
export const WithValues: Story = {
  args: {
    amount: 250,
    corridor: 'USD-NGN',
  },
};

/** Large amount */
export const LargeAmount: Story = {
  args: {
    amount: 10_000,
    corridor: 'USD-KES',
  },
};

/** Error state – trigger by passing an onError handler and an invalid corridor */
export const ErrorState: Story = {
  args: {
    amount: 100,
    corridor: 'INVALID-CORRIDOR',
    onError: (err: Error) => console.error('FeePreview error:', err),
  },
};
