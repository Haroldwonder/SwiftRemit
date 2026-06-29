import React, { useState } from 'react';

export interface CorridorMetrics {
  corridor: string;
  volume24h: number;
  txCount24h: number;
  avgAmount: number;
  successRate: number;
  avgSettlementTime: number;
  fxRate: number;
  fxRateCurrency: string;
}

export type TimeRange = '24h' | '7d' | '30d';

export interface CorridorAnalyticsProps {
  metrics?: CorridorMetrics[];
  isLoading?: boolean;
  defaultRange?: TimeRange;
  onRangeChange?: (range: TimeRange) => void;
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(2)}`;
}

export function CorridorAnalytics({
  metrics = [],
  isLoading = false,
  defaultRange = '24h',
  onRangeChange,
}: CorridorAnalyticsProps) {
  const [range, setRange] = useState<TimeRange>(defaultRange);

  const handleRangeChange = (newRange: TimeRange) => {
    setRange(newRange);
    onRangeChange?.(newRange);
  };

  const totalVolume = metrics.reduce((sum, m) => sum + m.volume24h, 0);
  const totalTx = metrics.reduce((sum, m) => sum + m.txCount24h, 0);

  if (isLoading) {
    return (
      <div
        className="corridor-analytics corridor-analytics--loading"
        data-testid="corridor-analytics-loading"
        aria-busy="true"
      >
        <div className="skeleton-header" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
    );
  }

  return (
    <div className="corridor-analytics" data-testid="corridor-analytics">
      <div className="analytics-header">
        <h2>Corridor Analytics</h2>
        <div className="range-selector" role="group" aria-label="Time range">
          {(['24h', '7d', '30d'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => handleRangeChange(r)}
              className={`range-btn ${range === r ? 'range-btn--active' : ''}`}
              aria-pressed={range === r}
              data-testid={`range-${r}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="analytics-summary" data-testid="analytics-summary">
        <div className="summary-card">
          <span className="summary-label">Total Volume ({range})</span>
          <span className="summary-value" data-testid="total-volume">
            {formatVolume(totalVolume)}
          </span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Total Transactions ({range})</span>
          <span className="summary-value" data-testid="total-tx">
            {totalTx.toLocaleString()}
          </span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Active Corridors</span>
          <span className="summary-value" data-testid="active-corridors">
            {metrics.length}
          </span>
        </div>
      </div>

      {metrics.length === 0 ? (
        <p className="empty-state" data-testid="empty-analytics">
          No corridor data available for this time range.
        </p>
      ) : (
        <div className="corridor-grid" data-testid="corridor-grid">
          {metrics.map((m) => (
            <div
              key={m.corridor}
              className="corridor-card"
              data-testid={`corridor-card-${m.corridor.replace(/[^a-z0-9]/gi, '-')}`}
            >
              <h3 className="corridor-name">{m.corridor}</h3>
              <div className="corridor-metrics">
                <div className="metric">
                  <span className="metric-label">Volume</span>
                  <span className="metric-value">
                    {formatVolume(m.volume24h)}
                  </span>
                </div>
                <div className="metric">
                  <span className="metric-label">Transactions</span>
                  <span className="metric-value">
                    {m.txCount24h.toLocaleString()}
                  </span>
                </div>
                <div className="metric">
                  <span className="metric-label">Avg Amount</span>
                  <span className="metric-value">
                    {formatVolume(m.avgAmount)}
                  </span>
                </div>
                <div className="metric">
                  <span className="metric-label">Success Rate</span>
                  <span
                    className={`metric-value ${m.successRate >= 0.95 ? 'text-success' : 'text-warning'}`}
                  >
                    {(m.successRate * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="metric">
                  <span className="metric-label">Avg Settlement</span>
                  <span className="metric-value">
                    {m.avgSettlementTime}s
                  </span>
                </div>
                <div className="metric">
                  <span className="metric-label">FX Rate</span>
                  <span className="metric-value">
                    1 USDC = {m.fxRate.toFixed(2)} {m.fxRateCurrency}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
