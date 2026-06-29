import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const RANGES = ['7d', '30d', '90d'];

function BarChart({ data, valueKey, labelKey, label }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d[valueKey]));
  return (
    <div style={{ marginTop: 12 }}>
      <strong>{label}</strong>
      {data.slice(0, 10).map((row, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <span style={{ width: 120, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row[labelKey]}
          </span>
          <div
            style={{
              height: 16,
              background: '#4f8ef7',
              borderRadius: 3,
              width: max > 0 ? `${(row[valueKey] / max) * 200}px` : 0,
              minWidth: 2,
            }}
          />
          <span style={{ fontSize: 12 }}>{Number(row[valueKey]).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function CorridorAnalytics() {
  const [range, setRange] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/analytics/corridors?range=${range}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setData(json.data);
        else setError(json.error?.message ?? 'Unknown error');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range]);

  const corridors = data?.corridors ?? [];
  const corridorLabels = corridors.map((c) => `${c.source_currency}→${c.destination_country}`);
  const withLabel = corridors.map((c, i) => ({ ...c, label: corridorLabels[i] }));

  return (
    <div style={{ padding: 16, border: '1px solid #ddd', borderRadius: 8, marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>Corridor Analytics</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            style={{
              padding: '4px 12px',
              borderRadius: 4,
              border: '1px solid #4f8ef7',
              background: range === r ? '#4f8ef7' : 'transparent',
              color: range === r ? '#fff' : '#4f8ef7',
              cursor: 'pointer',
            }}
          >
            {r}
          </button>
        ))}
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {!loading && !error && data && (
        <>
          <BarChart data={withLabel} valueKey="total_volume" labelKey="label" label="Volume by corridor" />
          <BarChart data={withLabel} valueKey="avg_fee" labelKey="label" label="Avg fee by corridor" />

          <div style={{ marginTop: 20, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f5f5f5' }}>
                  {['Corridor', 'Volume', 'Txns', 'Success %', 'Avg Fee', 'Total Fees'].map((h) => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corridors.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 10px' }}>{c.source_currency} → {c.destination_country}</td>
                    <td style={{ padding: '6px 10px' }}>{Number(c.total_volume).toLocaleString()}</td>
                    <td style={{ padding: '6px 10px' }}>{c.transaction_count}</td>
                    <td style={{ padding: '6px 10px' }}>{c.success_rate}%</td>
                    <td style={{ padding: '6px 10px' }}>{Number(c.avg_fee).toFixed(2)}</td>
                    <td style={{ padding: '6px 10px' }}>{Number(c.total_fees).toLocaleString()}</td>
                  </tr>
                ))}
                {corridors.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 12, textAlign: 'center', color: '#888' }}>No data for this period</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
