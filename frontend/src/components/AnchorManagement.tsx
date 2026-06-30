import { FC, useState, useEffect, FormEvent } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface AnchorForm {
  name: string
  domain: string
  description: string
  deposit_fee_percent: string
  withdrawal_fee_percent: string
  min_amount: string
  max_amount: string
  kyc_required: boolean
  kyc_level: 'basic' | 'standard' | 'full'
  supported_countries: string
  supported_currencies: string
}

interface Anchor extends AnchorForm {
  id: string
}

const EMPTY_FORM: AnchorForm = {
  name: '', domain: '', description: '',
  deposit_fee_percent: '', withdrawal_fee_percent: '',
  min_amount: '', max_amount: '',
  kyc_required: false, kyc_level: 'basic',
  supported_countries: '', supported_currencies: '',
}

const AnchorManagement: FC = () => {
  const [anchors, setAnchors] = useState<Anchor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<AnchorForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [healthStatus, setHealthStatus] = useState<Record<string, boolean>>({})

  useEffect(() => { fetchAnchors() }, [])

  async function fetchAnchors(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/anchors`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setAnchors(await res.json())
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) || 'Failed to fetch anchors')
      setAnchors([])
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setSaving(true)
    setError(null)
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
        kyc: {
          required: form.kyc_required,
          level: form.kyc_level,
        },
        supported_countries: form.supported_countries.split(',').map((c: string) => c.trim()),
        supported_currencies: form.supported_currencies.split(',').map((c: string) => c.trim()),
      }
      const method = editingId ? 'PUT' : 'POST'
      const url = editingId ? `${API_URL}/api/anchors/${editingId}` : `${API_URL}/api/anchors`
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setForm(EMPTY_FORM)
      setEditingId(null)
      await fetchAnchors()
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) || 'Failed to save anchor')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (anchor: Anchor): void => {
    setForm(anchor)
    setEditingId(anchor.id)
  }

  const handleDelete = async (id: string): Promise<void> => {
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/anchors/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await fetchAnchors()
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) || 'Failed to delete anchor')
    }
  }

  return (
    <div className="panel" role="main" aria-label="Anchor Management">
      <h2>Anchor Management</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="anchor-name">Anchor Name</label>
          <input
            id="anchor-name"
            type="text"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="anchor-domain">Domain</label>
          <input
            id="anchor-domain"
            type="text"
            value={form.domain}
            onChange={e => setForm({ ...form, domain: e.target.value })}
            placeholder="example.com"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="anchor-desc">Description</label>
          <textarea
            id="anchor-desc"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : editingId ? 'Update Anchor' : 'Add Anchor'}
        </button>
      </form>
      {error && <div className="error" role="alert">{error}</div>}
      <hr />
      {loading ? <p>Loading…</p> : anchors.length === 0 ? <p>No anchors configured.</p> : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {anchors.map(anchor => (
            <li key={anchor.id} style={{ padding: '12px', border: '1px solid #ddd', marginBottom: '8px', borderRadius: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>{anchor.name}</strong>
                  <p style={{ margin: '4px 0', fontSize: '0.9em', color: '#666' }}>{anchor.domain}</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => handleEdit(anchor)}>Edit</button>
                  <button onClick={() => handleDelete(anchor.id)} style={{ color: '#e53e3e' }}>Delete</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default AnchorManagement
