import type { Meta, StoryObj } from '@storybook/react';
import { SendMoneyFlow } from './index';

const meta: Meta<typeof SendMoneyFlow> = {
  title: 'Components/SendMoneyFlow',
  component: SendMoneyFlow,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    availableBalance: { control: 'number' },
    onComplete: { action: 'completed' },
    onCancel: { action: 'cancelled' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    availableBalance: 1000,
  },
};

export const LowBalance: Story = {
  args: {
    availableBalance: 10.5,
  },
};

export const ZeroBalance: Story = {
  args: {
    availableBalance: 0,
  },
};
