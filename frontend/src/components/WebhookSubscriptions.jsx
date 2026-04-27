import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const EMPTY_FORM = { url: '', events: [], secret: '' };
const ALL_EVENTS = ['remittance.created', 'remittance.completed', 'remittance.cancelled', 'payout.confirmed', 'dispute.raised', 'dispute.resolved'];

export default function WebhookSubscriptions() {
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [historyId, setHistoryId] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [testResult, setTestResult] = useState({});

  useEffect(() => { fetchSubscriptions(); }, []);

  async function fetchSubscriptions() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/webhooks`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubscriptions(await res.json());
    } catch (e) {
      setError(e.message);
      setSubscriptions([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.url || form.events.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `${API_URL}/api/webhooks/${editingId}` : `${API_URL}/api/webhooks`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForm(EMPTY_FORM);
      setEditingId(null);
      await fetchSubscriptions();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this webhook subscription?')) return;
    try {
      const res = await fetch(`${API_URL}/api/webhooks/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchSubscriptions();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleTest(id) {
    setTestResult(prev => ({ ...prev, [id]: 'sending...' }));
    try {
      const res = await fetch(`${API_URL}/api/webhooks/${id}/test`, { method: 'POST' });
      setTestResult(prev => ({ ...prev, [id]: res.ok ? '✅ Delivered' : `❌ HTTP ${res.status}` }));
    } catch (e) {
      setTestResult(prev => ({ ...prev, [id]: `❌ ${e.message}` }));
    }
  }

  async function loadHistory(id) {
    if (historyId === id) { setHistoryId(null); return; }
    setHistoryId(id);
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/webhooks/${id}/deliveries`);
      setHistory(res.ok ? await res.json() : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function startEdit(sub) {
    setEditingId(sub.id);
    setForm({ url: sub.url, events: sub.events, secret: sub.secret || '' });
  }

  function toggleEvent(ev) {
    setForm(f => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter(e => e !== ev) : [...f.events, ev],
    }));
  }

  return (
    <div className="panel" role="main" aria-label="Webhook Subscriptions">
      <h2>Webhook Subscriptions</h2>

      <form onSubmit={handleSubmit} aria-label={editingId ? 'Edit webhook' : 'Add webhook'}>
        <div className="form-group">
          <label htmlFor="wh-url">Endpoint URL</label>
          <input
            id="wh-url"
            type="url"
            value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            placeholder="https://example.com/webhook"
            required
          />
        </div>
        <div className="form-group">
          <label>Events</label>
          <div role="group" aria-label="Event types" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {ALL_EVENTS.map(ev => (
              <label key={ev} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={form.events.includes(ev)}
                  onChange={() => toggleEvent(ev)}
                  aria-label={ev}
                />
                {ev}
              </label>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="wh-secret">Signing Secret (optional)</label>
          <input
            id="wh-secret"
            type="password"
            value={form.secret}
            onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
            placeholder="Webhook signing secret"
          />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Update' : 'Add Webhook'}
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {error && <div className="error" role="alert">{error}</div>}

      <hr style={{ margin: '24px 0' }} />

      {loading ? (
        <p aria-live="polite">Loading…</p>
      ) : subscriptions.length === 0 ? (
        <p>No webhook subscriptions yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }} aria-label="Webhook list">
          {subscriptions.map(sub => (
            <li key={sub.id} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <strong>{sub.url}</strong>
                  <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '4px' }}>
                    {sub.events?.join(', ')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button onClick={() => handleTest(sub.id)} aria-label={`Test ${sub.url}`}>
                    Test
                  </button>
                  <button onClick={() => startEdit(sub)} aria-label={`Edit ${sub.url}`}>
                    Edit
                  </button>
                  <button onClick={() => handleDelete(sub.id)} aria-label={`Delete ${sub.url}`} style={{ color: '#e53e3e' }}>
                    Delete
                  </button>
                  <button onClick={() => loadHistory(sub.id)} aria-label={`History for ${sub.url}`}>
                    History
                  </button>
                </div>
              </div>
              {testResult[sub.id] && (
                <div style={{ marginTop: '8px', fontSize: '0.85rem' }} aria-live="polite">
                  {testResult[sub.id]}
                </div>
              )}
              {historyId === sub.id && (
                <div style={{ marginTop: '12px' }} aria-label="Delivery history">
                  <strong>Delivery History</strong>
                  {historyLoading ? (
                    <p>Loading…</p>
                  ) : history.length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: '#666' }}>No deliveries yet.</p>
                  ) : (
                    <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse', marginTop: '8px' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '4px' }}>Time</th>
                          <th style={{ textAlign: 'left', padding: '4px' }}>Event</th>
                          <th style={{ textAlign: 'left', padding: '4px' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((d, i) => (
                          <tr key={i}>
                            <td style={{ padding: '4px' }}>{new Date(d.timestamp).toLocaleString()}</td>
                            <td style={{ padding: '4px' }}>{d.event}</td>
                            <td style={{ padding: '4px' }}>{d.status_code ?? d.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
