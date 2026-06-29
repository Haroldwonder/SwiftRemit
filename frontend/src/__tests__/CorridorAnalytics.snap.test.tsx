import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CorridorAnalytics, CorridorMetrics } from '../components/CorridorAnalytics';

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
];

describe('CorridorAnalytics snapshots', () => {
  it('renders with default 24h range and metrics', () => {
    const { container } = render(
      <CorridorAnalytics metrics={sampleMetrics} defaultRange="24h" />,
    );
    expect(container).toMatchSnapshot();
  });

  it('renders loading state', () => {
    const { container } = render(<CorridorAnalytics isLoading />);
    expect(container).toMatchSnapshot();
  });

  it('renders empty state with no metrics', () => {
    const { container } = render(<CorridorAnalytics metrics={[]} />);
    expect(container).toMatchSnapshot();
  });

  it('renders 7-day range view', () => {
    const { container } = render(
      <CorridorAnalytics
        metrics={sampleMetrics}
        defaultRange="7d"
        onRangeChange={vi.fn()}
      />,
    );
    expect(container).toMatchSnapshot();
  });

  it('renders 30-day range view', () => {
    const { container } = render(
      <CorridorAnalytics
        metrics={sampleMetrics}
        defaultRange="30d"
        onRangeChange={vi.fn()}
      />,
    );
    expect(container).toMatchSnapshot();
  });

  it('renders summary aggregates correctly for multiple corridors', () => {
    const { container } = render(
      <CorridorAnalytics metrics={sampleMetrics} />,
    );
    expect(container).toMatchSnapshot();
  });
});
