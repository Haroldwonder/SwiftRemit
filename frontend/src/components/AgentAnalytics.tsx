/**
 * AgentAnalytics.tsx — Issue #947
 *
 * Agent-facing payout analytics dashboard. Displays:
 *  - Summary KPIs: total payouts, earnings (USDC), avg confirmation time,
 *    reputation score, and success rate.
 *  - Time-series chart of payouts and earnings bucketed by day / week / month.
 *
 * Authentication is handled by the parent; the component receives the agent's
 * bearer token and stellar address as props.
 */

import React, { useEffect, useState, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentAnalyticsSummary {
  agent_id: string;
  from: string;
  to: string;
  total_payouts: number;
  total_earnings_usdc: number;
  avg_confirmation_time_seconds: number;
  reputation_score: number | null;
  success_rate: number;
}

interface TimeSeriesPoint {
  bucket: string;
  payouts: number;
  earnings_usdc: number;
  avg_confirmation_time_seconds: number;
}

interface AnalyticsData {
  summary: AgentAnalyticsSummary;
  time_series: TimeSeriesPoint[];
  interval: 'day' | 'week' | 'month';
}

type Interval = 'day' | 'week' | 'month';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AgentAnalyticsProps {
  /** Stellar address of the authenticated agent */
  agentId: string;
  /** Bearer token or API key used to authenticate the analytics request */
  authToken: string;
  /** Base URL of the API service (defaults to empty string — same origin) */
  apiBase?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUsdc(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 1e7); // USDC uses 7 decimal places (stroops)
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function isoToLabel(isoDate: string, interval: Interval): string {
  const d = new Date(isoDate);
  if (interval === 'month') {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
  if (interval === 'week') {
    return `W${getISOWeek(d)}`;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getISOWeek(date: Date): number {
  const tmp = new Date(date.valueOf());
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((tmp.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    )
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
}

function KpiCard({ label, value, sub }: KpiCardProps) {
  return (
    <div
      style={{
        background: 'var(--surface, #1e293b)',
        borderRadius: 8,
        padding: '16px 20px',
        minWidth: 140,
        flex: '1 1 140px',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/** Minimal bar chart rendered in pure SVG — no external chart library required. */
interface BarChartProps {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  yLabel?: string;
}

function BarChart({ data, color = '#6366f1', height = 140, yLabel }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = Math.max(8, Math.floor(480 / Math.max(data.length, 1)) - 4);
  const totalW = data.length * (barW + 4) + 40;

  return (
    <div role="img" aria-label={`Bar chart: ${yLabel ?? 'values'}`} style={{ overflowX: 'auto' }}>
      <svg width={totalW} height={height + 40} aria-hidden="true">
        {/* Y-axis label */}
        {yLabel && (
          <text
            x={8}
            y={height / 2}
            fontSize={10}
            fill="var(--text-muted, #94a3b8)"
            transform={`rotate(-90, 8, ${height / 2})`}
            textAnchor="middle"
          >
            {yLabel}
          </text>
        )}
        {data.map((d, i) => {
          const barH = Math.max(2, Math.round((d.value / max) * height));
          const x = 30 + i * (barW + 4);
          const y = height - barH;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={3}
                fill={color}
                opacity={0.85}
              >
                <title>
                  {d.label}: {d.value}
                </title>
              </rect>
              <text
                x={x + barW / 2}
                y={height + 14}
                fontSize={9}
                fill="var(--text-muted, #94a3b8)"
                textAnchor="middle"
              >
                {d.label}
              </text>
            </g>
          );
        })}
        {/* baseline */}
        <line
          x1={28}
          y1={height}
          x2={totalW - 4}
          y2={height}
          stroke="var(--border, #334155)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AgentAnalytics({ agentId, authToken, apiBase = '' }: AgentAnalyticsProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval_] = useState<Interval>('day');
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, interval });
      const res = await fetch(
        `${apiBase}/api/agents/${encodeURIComponent(agentId)}/analytics?${params}`,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json.data as AnalyticsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [agentId, authToken, apiBase, from, to, interval]);

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics]);

  const s = data?.summary;

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        color: 'var(--text, #f1f5f9)',
        maxWidth: 900,
        margin: '0 auto',
        padding: 24,
      }}
    >
      <h2 style={{ marginBottom: 4, fontSize: 20 }}>Payout Analytics</h2>
      <p style={{ color: 'var(--text-muted, #94a3b8)', marginBottom: 20, fontSize: 13 }}>
        Agent: <code>{agentId}</code>
      </p>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          To
          <input
            type="date"
            value={to}
            min={from}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setTo(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Interval
          <select
            value={interval}
            onChange={(e) => setInterval_(e.target.value as Interval)}
            style={inputStyle}
          >
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </label>
        <button
          onClick={() => void fetchAnalytics()}
          disabled={loading}
          style={{
            alignSelf: 'flex-end',
            padding: '6px 18px',
            borderRadius: 6,
            border: 'none',
            background: '#6366f1',
            color: '#fff',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            fontSize: 13,
          }}
          aria-busy={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div
          role="alert"
          style={{
            background: '#450a0a',
            color: '#fca5a5',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 20,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      {s && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 28 }}>
          <KpiCard label="Total Payouts" value={s.total_payouts.toLocaleString()} />
          <KpiCard
            label="Earnings (USDC)"
            value={formatUsdc(s.total_earnings_usdc)}
            sub="net agent fees"
          />
          <KpiCard
            label="Avg Confirmation"
            value={formatSeconds(s.avg_confirmation_time_seconds)}
          />
          <KpiCard
            label="Success Rate"
            value={`${s.success_rate.toFixed(1)}%`}
          />
          <KpiCard
            label="Reputation Score"
            value={s.reputation_score != null ? s.reputation_score.toString() : '—'}
            sub="0–100"
          />
        </div>
      )}

      {/* ── Charts ────────────────────────────────────────────────────────── */}
      {data && data.time_series.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, marginBottom: 10, color: 'var(--text-muted, #94a3b8)' }}>
            Payouts over time
          </h3>
          <BarChart
            data={data.time_series.map((p) => ({
              label: isoToLabel(p.bucket, interval),
              value: p.payouts,
            }))}
            color="#6366f1"
            yLabel="payouts"
          />

          <h3 style={{ fontSize: 14, marginTop: 24, marginBottom: 10, color: 'var(--text-muted, #94a3b8)' }}>
            Earnings (USDC stroops) over time
          </h3>
          <BarChart
            data={data.time_series.map((p) => ({
              label: isoToLabel(p.bucket, interval),
              value: p.earnings_usdc,
            }))}
            color="#10b981"
            yLabel="earnings"
          />
        </>
      )}

      {data && data.time_series.length === 0 && !loading && (
        <p style={{ color: 'var(--text-muted, #94a3b8)', fontSize: 13 }}>
          No payout data for the selected date range.
        </p>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface, #1e293b)',
  border: '1px solid var(--border, #334155)',
  borderRadius: 6,
  color: 'var(--text, #f1f5f9)',
  padding: '4px 10px',
  fontSize: 13,
};

export default AgentAnalytics;
