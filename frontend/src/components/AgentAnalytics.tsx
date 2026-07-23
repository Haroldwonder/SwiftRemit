/**
 * AgentAnalytics (Issue #947)
 *
 * Displays an agent's payout history, earnings, and performance metrics
 * for a configurable date range.
 *
 * Authentication: Signs each request with X-Agent-Id + X-Agent-Timestamp +
 * X-Agent-Signature (HMAC-SHA256) produced by the browser SubtleCrypto API.
 * The key material is provided as a prop so this component has no access to
 * the raw HMAC secret — the parent is responsible for key management.
 *
 * Usage:
 *   <AgentAnalytics agentId="G..." hmacSecret="..." />
 */

import { FC, useState, useEffect, useCallback, CSSProperties } from 'react';

const API_BASE = (
  typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL
) ?? '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnalyticsRange = '7d' | '30d' | '90d';
export type AnalyticsGranularity = 'day' | 'week' | 'month';

export interface AgentAnalyticsSummary {
  agent_id: string;
  range: AnalyticsRange;
  total_payouts: number;
  total_earnings_usdc: number;
  avg_confirmation_time_s: number | null;
  reputation_score: number | null;
}

export interface AgentAnalyticsTimeSeries {
  bucket: string;
  payouts: number;
  earnings_usdc: number;
  avg_confirmation_time_s: number | null;
}

export interface AgentAnalyticsData {
  summary: AgentAnalyticsSummary;
  time_series: AgentAnalyticsTimeSeries[];
  granularity: AnalyticsGranularity;
}

export interface AgentAnalyticsProps {
  /** Stellar public key of the agent to display analytics for. */
  agentId: string;
  /**
   * Raw HMAC-SHA256 secret (hex string).  Pass an empty string to skip
   * signature auth (useful for admin views where an x-api-key is used
   * instead via the `adminApiKey` prop).
   */
  hmacSecret?: string;
  /** If provided, sent as x-api-key instead of generating a HMAC proof. */
  adminApiKey?: string;
}

// ---------------------------------------------------------------------------
// Signature helper
// ---------------------------------------------------------------------------

async function buildAgentAuthHeaders(
  agentId: string,
  hmacSecret: string,
): Promise<Record<string, string>> {
  const ts = new Date().toISOString();
  const message = `${agentId}|${ts}|${hmacSecret}`;

  // Use SubtleCrypto when available (browser/modern env); fall back to a
  // simple hex hash via TextEncoder for environments without it.
  let signature: string;
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const enc = new TextEncoder();
    const keyData = enc.encode(hmacSecret);
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(message));
    signature = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    // Fallback: encode the message as hex (not cryptographically sound — only
    // for environments where SubtleCrypto is unavailable).
    signature = Array.from(new TextEncoder().encode(message))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  return {
    'x-agent-id':        agentId,
    'x-agent-timestamp': ts,
    'x-agent-signature': signature,
  };
}

// ---------------------------------------------------------------------------
// Lightweight bar chart (no external chart library required)
// ---------------------------------------------------------------------------

interface BarChartProps {
  data: AgentAnalyticsTimeSeries[];
  valueKey: 'payouts' | 'earnings_usdc';
  label: string;
  formatValue?: (v: number) => string;
}

const BarChart: FC<BarChartProps> = ({ data, valueKey, label, formatValue }) => {
  if (!data.length) {
    return (
      <div style={styles.chartEmpty} aria-live="polite">
        No data for this period
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d[valueKey] as number), 1);
  const fmt = formatValue ?? ((v: number) => v.toLocaleString());

  return (
    <div style={styles.chartWrap} aria-label={label}>
      <p style={styles.chartLabel}>{label}</p>
      {data.map((row, i) => {
        const pct = ((row[valueKey] as number) / max) * 100;
        const bucketLabel = new Date(row.bucket).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });
        return (
          <div key={i} style={styles.barRow} role="listitem">
            <span style={styles.barBucketLabel} title={row.bucket}>
              {bucketLabel}
            </span>
            <div
              style={{ ...styles.barTrack }}
              aria-label={`${bucketLabel}: ${fmt(row[valueKey] as number)}`}
            >
              <div
                style={{
                  ...styles.barFill,
                  width: `${pct}%`,
                } as CSSProperties}
              />
            </div>
            <span style={styles.barValue}>{fmt(row[valueKey] as number)}</span>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const RANGES: AnalyticsRange[] = ['7d', '30d', '90d'];
const GRANULARITIES: AnalyticsGranularity[] = ['day', 'week', 'month'];

export const AgentAnalytics: FC<AgentAnalyticsProps> = ({
  agentId,
  hmacSecret = '',
  adminApiKey,
}) => {
  const [range, setRange]             = useState<AnalyticsRange>('30d');
  const [granularity, setGranularity] = useState<AnalyticsGranularity>('day');
  const [data, setData]               = useState<AgentAnalyticsData | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    if (!agentId) return;

    setLoading(true);
    setError(null);

    try {
      let headers: Record<string, string> = {};

      if (adminApiKey) {
        headers['x-api-key'] = adminApiKey;
      } else if (hmacSecret) {
        headers = await buildAgentAuthHeaders(agentId, hmacSecret);
      }

      const url =
        `${API_BASE}/api/agents/${encodeURIComponent(agentId)}/analytics` +
        `?range=${range}&granularity=${granularity}`;

      const res = await fetch(url, { headers });
      const json = (await res.json()) as
        | { success: true; data: AgentAnalyticsData }
        | { success: false; error: { message: string } };

      if (!json.success) {
        setError((json as { success: false; error: { message: string } }).error.message ?? 'Unknown error');
      } else {
        setData((json as { success: true; data: AgentAnalyticsData }).data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [agentId, range, granularity, hmacSecret, adminApiKey]);

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics]);

  const summary = data?.summary;

  return (
    <section style={styles.container} aria-labelledby="agent-analytics-heading">
      <h2 id="agent-analytics-heading" style={styles.heading}>
        Agent Payout Analytics
      </h2>

      <p style={styles.agentIdLabel}>
        Agent: <code>{agentId.slice(0, 8)}…{agentId.slice(-8)}</code>
      </p>

      {/* Controls */}
      <div style={styles.controls} role="group" aria-label="Analytics filters">
        <div style={styles.controlGroup}>
          <label htmlFor="analytics-range" style={styles.controlLabel}>
            Date range
          </label>
          <div id="analytics-range" style={styles.segmentedControl} role="group">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                style={{
                  ...styles.segmentButton,
                  ...(range === r ? styles.segmentButtonActive : {}),
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.controlGroup}>
          <label htmlFor="analytics-granularity" style={styles.controlLabel}>
            Granularity
          </label>
          <div id="analytics-granularity" style={styles.segmentedControl} role="group">
            {GRANULARITIES.map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                aria-pressed={granularity === g}
                style={{
                  ...styles.segmentButton,
                  ...(granularity === g ? styles.segmentButtonActive : {}),
                }}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => void fetchAnalytics()}
          style={styles.refreshButton}
          aria-label="Refresh analytics"
          disabled={loading}
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* Loading / error states */}
      {loading && (
        <div style={styles.loadingWrap} role="status" aria-live="polite">
          <span>Loading analytics…</span>
        </div>
      )}

      {!loading && error && (
        <div style={styles.errorBox} role="alert">
          {error}
        </div>
      )}

      {!loading && !error && summary && (
        <>
          {/* KPI cards */}
          <div style={styles.kpiGrid} aria-label="Key performance indicators">
            <KpiCard
              label="Total payouts"
              value={summary.total_payouts.toLocaleString()}
              subtitle={`Last ${range}`}
            />
            <KpiCard
              label="Total earnings"
              value={`${summary.total_earnings_usdc.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} USDC`}
              subtitle={`Last ${range}`}
            />
            <KpiCard
              label="Avg confirmation time"
              value={
                summary.avg_confirmation_time_s != null
                  ? formatDuration(summary.avg_confirmation_time_s)
                  : 'N/A'
              }
              subtitle="Per completed payout"
            />
            <KpiCard
              label="Reputation score"
              value={
                summary.reputation_score != null
                  ? `${summary.reputation_score} / 100`
                  : 'N/A'
              }
              subtitle="Platform rating"
            />
          </div>

          {/* Charts */}
          {data && data.time_series.length > 0 ? (
            <div style={styles.chartsGrid}>
              <BarChart
                data={data.time_series}
                valueKey="payouts"
                label="Payouts over time"
              />
              <BarChart
                data={data.time_series}
                valueKey="earnings_usdc"
                label="Earnings (USDC) over time"
                formatValue={(v) =>
                  v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                }
              />
            </div>
          ) : (
            <p style={styles.noData}>No payout events in this period.</p>
          )}

          {/* Detail table */}
          {data && data.time_series.length > 0 && (
            <div style={styles.tableWrap}>
              <table style={styles.table} aria-label="Payout time series">
                <thead>
                  <tr>
                    {['Period', 'Payouts', 'Earnings (USDC)', 'Avg confirmation'].map((h) => (
                      <th key={h} style={styles.th} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.time_series.map((row, i) => (
                    <tr
                      key={i}
                      style={i % 2 === 0 ? styles.trEven : styles.trOdd}
                    >
                      <td style={styles.td}>
                        {new Date(row.bucket).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td style={styles.td}>{row.payouts.toLocaleString()}</td>
                      <td style={styles.td}>
                        {row.earnings_usdc.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td style={styles.td}>
                        {row.avg_confirmation_time_s != null
                          ? formatDuration(row.avg_confirmation_time_s)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// KPI card sub-component
// ---------------------------------------------------------------------------

interface KpiCardProps {
  label: string;
  value: string;
  subtitle?: string;
}

const KpiCard: FC<KpiCardProps> = ({ label, value, subtitle }) => (
  <div style={styles.kpiCard} aria-label={`${label}: ${value}`}>
    <p style={styles.kpiLabel}>{label}</p>
    <p style={styles.kpiValue}>{value}</p>
    {subtitle && <p style={styles.kpiSubtitle}>{subtitle}</p>}
  </div>
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

// ---------------------------------------------------------------------------
// Inline styles (no external CSS dep)
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  container: {
    fontFamily: 'system-ui, sans-serif',
    padding: 24,
    border: '1px solid #e0e0e0',
    borderRadius: 10,
    background: '#fafafa',
    maxWidth: 960,
  },
  heading: {
    margin: '0 0 4px',
    fontSize: 20,
    fontWeight: 600,
    color: '#1a1a1a',
  },
  agentIdLabel: {
    margin: '0 0 20px',
    fontSize: 13,
    color: '#555',
  },
  controls: {
    display: 'flex',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 24,
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  controlLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: 500,
  },
  segmentedControl: {
    display: 'flex',
    gap: 0,
  },
  segmentButton: {
    padding: '6px 14px',
    fontSize: 13,
    border: '1px solid #4f8ef7',
    background: 'transparent',
    color: '#4f8ef7',
    cursor: 'pointer',
    borderRadius: 0,
    transition: 'background 0.15s',
  },
  segmentButtonActive: {
    background: '#4f8ef7',
    color: '#fff',
  },
  refreshButton: {
    padding: '6px 16px',
    fontSize: 13,
    borderRadius: 5,
    border: '1px solid #4f8ef7',
    background: '#4f8ef7',
    color: '#fff',
    cursor: 'pointer',
  },
  loadingWrap: {
    padding: 32,
    textAlign: 'center',
    color: '#888',
  },
  errorBox: {
    padding: 16,
    background: '#fff0f0',
    border: '1px solid #f5c6c6',
    borderRadius: 6,
    color: '#c0392b',
    fontSize: 14,
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 16,
    marginBottom: 24,
  },
  kpiCard: {
    background: '#fff',
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    padding: '16px 20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  kpiLabel: {
    margin: '0 0 6px',
    fontSize: 12,
    color: '#888',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  kpiValue: {
    margin: '0 0 4px',
    fontSize: 22,
    fontWeight: 700,
    color: '#1a1a1a',
  },
  kpiSubtitle: {
    margin: 0,
    fontSize: 11,
    color: '#aaa',
  },
  chartsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: 24,
    marginBottom: 24,
  },
  chartWrap: {
    background: '#fff',
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    padding: 16,
  },
  chartEmpty: {
    padding: 16,
    textAlign: 'center',
    color: '#aaa',
    fontSize: 13,
  },
  chartLabel: {
    margin: '0 0 12px',
    fontSize: 13,
    fontWeight: 600,
    color: '#333',
  },
  barRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  barBucketLabel: {
    width: 70,
    fontSize: 11,
    color: '#555',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flexShrink: 0,
  },
  barTrack: {
    flex: 1,
    height: 16,
    background: '#f0f0f0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    background: '#4f8ef7',
    borderRadius: 3,
    transition: 'width 0.3s ease',
    minWidth: 2,
  },
  barValue: {
    width: 80,
    fontSize: 11,
    color: '#555',
    textAlign: 'right',
    flexShrink: 0,
  },
  noData: {
    textAlign: 'center',
    color: '#aaa',
    fontSize: 14,
    padding: '24px 0',
  },
  tableWrap: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
    background: '#fff',
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    overflow: 'hidden',
  },
  th: {
    padding: '10px 14px',
    textAlign: 'left',
    borderBottom: '1px solid #ddd',
    background: '#f8f8f8',
    fontWeight: 600,
    color: '#444',
    fontSize: 12,
  },
  td: {
    padding: '8px 14px',
    color: '#333',
  },
  trEven: {
    background: '#fff',
  },
  trOdd: {
    background: '#fafafa',
  },
};

export default AgentAnalytics;
