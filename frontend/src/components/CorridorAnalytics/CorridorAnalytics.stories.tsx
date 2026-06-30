import type { Meta, StoryObj } from '@storybook/react';
import { CorridorAnalytics, CorridorMetrics } from './index';

const sampleMetrics: CorridorMetrics[] = [
  {
    corridor: 'USD → KES',
    volume24h: 425000,
    txCount24h: 1850,
    avgAmount: 229.73,
    successRate: 0.987,
    avgSettlementTime: 42,
    fxRate: 129.5,
    fxRateCurrency: 'KES',
  },
  {
    corridor: 'USD → NGN',
    volume24h: 318000,
    txCount24h: 1240,
    avgAmount: 256.45,
    successRate: 0.972,
    avgSettlementTime: 55,
    fxRate: 1580.0,
    fxRateCurrency: 'NGN',
  },
  {
    corridor: 'USD → GHS',
    volume24h: 142000,
    txCount24h: 620,
    avgAmount: 229.03,
    successRate: 0.961,
    avgSettlementTime: 38,
    fxRate: 15.4,
    fxRateCurrency: 'GHS',
  },
  {
    corridor: 'USD → ZAR',
    volume24h: 89000,
    txCount24h: 310,
    avgAmount: 287.1,
    successRate: 0.993,
    avgSettlementTime: 29,
    fxRate: 18.62,
    fxRateCurrency: 'ZAR',
  },
];

const meta: Meta<typeof CorridorAnalytics> = {
  title: 'Components/CorridorAnalytics',
  component: CorridorAnalytics,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    defaultRange: {
      control: 'select',
      options: ['24h', '7d', '30d'],
    },
    onRangeChange: { action: 'rangeChanged' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    metrics: sampleMetrics,
    defaultRange: '24h',
  },
};

export const Loading: Story = {
  args: {
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    metrics: [],
  },
};

export const SevenDayView: Story = {
  args: {
    metrics: sampleMetrics,
    defaultRange: '7d',
  },
};
