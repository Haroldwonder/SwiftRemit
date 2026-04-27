import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const EMPTY_FORM = {
  name: '', domain: '', description: '',
  deposit_fee_percent: '', withdrawal_fee_percent: '',
  min_amount: '', max_amount: '',
  kyc_required: false, kyc_level: 'basic',
  supported_countries: '', supported_currencies: '',
};

export default function AnchorManagement() {
  const [anchors, setAnchors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [healthStatus, setHealthStatus] = useState({});

  useEffect(() => { fetchAnchors(); }, []);

  async function fetchAnchors() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/anchors`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAnchors(await res.json());
    } catch (e) {
      setError(e.message);
      setAnchors([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        domain: form.domain,
        description: form.description,
        fees: {
          deposit_fee_percent: parseFloat(form.deposit_fee_percent) || 0,
          withdrawal_fee_percent: parseFloat(form.withdrawal_fee_percent) || 0,
        },
        limits: {
          min_amount: parseFloat(form.min_amount) || 0,
          max_amount: parseFloat(form.max_amount) || 0,
        },
        compliance: {
          kyc_required: form.kyc_required,
          kyc_level: form.kyc_level,
          supported_countries: form.supported_countries.split(',').map(s => s.trim()).filter(Boolean),
        },
        supported_currencies: form.supported_currencies.split(',').map(s => s.trim()).filter(Boolean),
      };
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `${API_URL}/api/anchors/${editingId}` : `${API_URL}/api/anchors`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForm(EMPTY_FORM);
      setEditingId(null);
      await fetchAnchors();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(anchor) {
    try {
      const newStatus = anchor.status === 'active' ? 'inactive' : 'active';
      const res = await fetch(`${API_URL}/api/anchors/${anchor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchAnchors();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this anchor provider?')) return;
    try {
      const res = await fetch(`${API_URL}/api/anchors/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchAnchors();
    } catch (e) {
      setError(e.message);
    }
  }

  async function checkHealth(anchor) {
    setHealthStatus(prev => ({ ...prev, [anchor.id]: 'checking…' }));
    try {
      const res = await fetch(`${API_URL}/api/anchors/${anchor.id}/health`);
      const data = res.ok ? await res.json() : null;
      setHealthStatus(prev => ({ ...prev, [anchor.id]: data?.healthy ? '✅ Healthy' : '❌ Unhealthy' }));
    } catch {
      setHealthStatus(prev => ({ ...prev, [anchor.id]: '❌ Unreachable' }));
    }
  }

  function startEdit(anchor) {
    setEditingId(anchor.id);
    setForm({
      name: anchor.name,
      domain: anchor.domain,
      description: anchor.description || '',
      deposit_fee_percent: anchor.fees?.deposit_fee_percent ?? '',
      withdrawal_fee_percent: anchor.fees?.withdrawal_fee_percent ?? '',
      min_amount: anchor.limits?.min_amount ?? '',
      max_amount: anchor.limits?.max_amount ?? '',
      kyc_required: anchor.compliance?.kyc_required ?? false,
      kyc_level: anchor.compliance?.kyc_level ?? 'basic',
      supported_countries: anchor.compliance?.supported_countries?.join(', ') ?? '',
      supported_currencies: anchor.supported_currencies?.join(', ') ?? '',
    });
  }

  const statusColor = { active: '#38a169', inactive: '#718096', maintenance: '#d69e2e' };

  return (
    <div className="panel" role="main" aria-label="Anchor Management">
      <h2>Anchor Catalog</h2>

      <form onSubmit={handleSubmit} aria-label={editingId ? 'Edit anchor' : 'Add anchor'}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label htmlFor="anc-name">Name *</label>
            <input id="anc-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label htmlFor="anc-domain">Domain *</label>
            <input id="anc-domain" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} placeholder="anchor.example.com" required />
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="anc-desc">Description</label>
            <input id="anc-desc" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="form-group">
            <label htmlFor="anc-dep-fee">Deposit Fee %</label>
            <input id="anc-dep-fee" type="number" min="0" step="0.01" value={form.deposit_fee_percent} onChange={e => setForm(f => ({ ...f, deposit_fee_percent: e.target.value }))} />
          </div>
          <div className="form-group">
            <label htmlFor="anc-wit-fee">Withdrawal Fee %</label>
            <input id="anc-wit-fee" type="number" min="0" step="0.01" value={form.withdrawal_fee_percent} onChange={e => setForm(f => ({ ...f, withdrawal_fee_percent: e.target.value }))} />
          </div>
          <div className="form-group">
            <label htmlFor="anc-min">Min Amount</label>
            <input id="anc-min" type="number" min="0" value={form.min_amount} onChange={e => setForm(f => ({ ...f, min_amount: e.target.value }))} />
          </div>
          <div className="form-group">
            <label htmlFor="anc-max">Max Amount</label>
            <input id="anc-max" type="number" min="0" value={form.max_amount} onChange={e => setForm(f => ({ ...f, max_amount: e.target.value }))} />
          </div>
          <div className="form-group">
            <label htmlFor="anc-currencies">Currencies (comma-separated)</label>
            <input id="anc-currencies" value={form.supported_currencies} onChange={e => setForm(f => ({ ...f, supported_currencies: e.target.value }))} placeholder="USD, EUR, NGN" />
          </div>
          <div className="form-group">
            <label htmlFor="anc-countries">Countries (comma-separated)</label>
            <input id="anc-countries" value={form.supported_countries} onChange={e => setForm(f => ({ ...f, supported_countries: e.target.value }))} placeholder="US, NG, GH" />
          </div>
          <div className="form-group">
            <label htmlFor="anc-kyc-level">KYC Level</label>
            <select id="anc-kyc-level" value={form.kyc_level} onChange={e => setForm(f => ({ ...f, kyc_level: e.target.value }))}>
              <option value="basic">Basic</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input id="anc-kyc-req" type="checkbox" checked={form.kyc_required} onChange={e => setForm(f => ({ ...f, kyc_required: e.target.checked }))} />
            <label htmlFor="anc-kyc-req">KYC Required</label>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Update Anchor' : 'Add Anchor'}
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>Cancel</button>
          )}
        </div>
      </form>

      {error && <div className="error" role="alert">{error}</div>}

      <hr style={{ margin: '24px 0' }} />

      {loading ? (
        <p aria-live="polite">Loading…</p>
      ) : anchors.length === 0 ? (
        <p>No anchor providers yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }} aria-label="Anchor list">
          {anchors.map(anchor => (
            <li key={anchor.id} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <strong>{anchor.name}</strong>
                  <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: statusColor[anchor.status] || '#718096', fontWeight: 600 }}>
                    ● {anchor.status}
                  </span>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>{anchor.domain}</div>
                  {anchor.description && <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '2px' }}>{anchor.description}</div>}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => toggleStatus(anchor)}
                    aria-label={`${anchor.status === 'active' ? 'Disable' : 'Enable'} ${anchor.name}`}
                  >
                    {anchor.status === 'active' ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => checkHealth(anchor)} aria-label={`Check health of ${anchor.name}`}>
                    Health
                  </button>
                  <button onClick={() => startEdit(anchor)} aria-label={`Edit ${anchor.name}`}>Edit</button>
                  <button onClick={() => handleDelete(anchor.id)} aria-label={`Delete ${anchor.name}`} style={{ color: '#e53e3e' }}>Delete</button>
                </div>
              </div>
              {healthStatus[anchor.id] && (
                <div style={{ marginTop: '6px', fontSize: '0.85rem' }} aria-live="polite">{healthStatus[anchor.id]}</div>
              )}
              <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#555', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <span>Deposit: {anchor.fees?.deposit_fee_percent ?? '—'}%</span>
                <span>Withdrawal: {anchor.fees?.withdrawal_fee_percent ?? '—'}%</span>
                <span>Limits: {anchor.limits?.min_amount ?? '—'} – {anchor.limits?.max_amount ?? '—'}</span>
                <span>KYC: {anchor.compliance?.kyc_level ?? '—'}</span>
                <span>Currencies: {anchor.supported_currencies?.join(', ') || '—'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
