import { FC, useState, useEffect, FormEvent } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface WebhookForm {
  url: string
  events: string[]
  secret: string
}

interface WebhookSubscription extends WebhookForm {
  id: string
  secret_rotated_at?: string | null
  has_previous_secret?: boolean
}

const EMPTY_FORM: WebhookForm = { url: '', events: [], secret: '' }
const ALL_EVENTS = ['remittance.created', 'remittance.completed', 'remittance.cancelled', 'payout.confirmed', 'dispute.raised', 'dispute.resolved']

const WebhookSubscriptions: FC = () => {
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<WebhookForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [history, setHistory] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [testResult, setTestResult] = useState<Record<string, any>>({})

  useEffect(() => { fetchSubscriptions() }, [])

  async function fetchSubscriptions(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/webhooks`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSubscriptions(await res.json())
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) || 'Failed to fetch webhooks')
      setSubscriptions([])
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (!form.url || form.events.length === 0) return
    setSaving(true)
    setError(null)
    try {
      const method = editingId ? 'PUT' : 'POST'
      const url = editingId ? `${API_URL}/api/webhooks/${editingId}` : `${API_URL}/api/webhooks`
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setForm(EMPTY_FORM)
      setEditingId(null)
      await fetchSubscriptions()
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) || 'Failed to save webhook')
    } finally {
      setSaving(false)
    }
  }

  const toggleEvent = (event: string): void => {
    setForm({
      ...form,
      events: form.events.includes(event)
        ? form.events.filter((e) => e !== event)
        : [...form.events, event],
    })
  }

  const handleEdit = (subscription: WebhookSubscription): void => {
    setForm(subscription)
    setEditingId(subscription.id)
  }

  return (
    <div className="panel" role="main" aria-label="Webhook Subscriptions">
      <h2>Webhook Subscriptions</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="webhook-url">Webhook URL</label>
          <input
            id="webhook-url"
            type="url"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://example.com/webhooks"
            required
          />
        </div>
        <div className="form-group">
          <label>Events</label>
          {ALL_EVENTS.map((event) => (
            <div key={event} style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
              <input
                type="checkbox"
                id={`event-${event}`}
                checked={form.events.includes(event)}
                onChange={() => toggleEvent(event)}
              />
              <label htmlFor={`event-${event}`} style={{ marginLeft: '8px', marginBottom: 0 }}>
                {event}
              </label>
            </div>
          ))}
        </div>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : editingId ? 'Update Webhook' : 'Add Webhook'}
        </button>
      </form>
      {error && <div className="error" role="alert">{error}</div>}
      <hr />
      {loading ? <p>Loading…</p> : subscriptions.length === 0 ? <p>No webhooks subscribed.</p> : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {subscriptions.map((sub) => (
            <li key={sub.id} style={{ padding: '12px', border: '1px solid #ddd', marginBottom: '8px', borderRadius: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <code>{sub.url}</code>
                  <p style={{ margin: '4px 0', fontSize: '0.9em', color: '#666' }}>{sub.events.join(', ')}</p>
                  {sub.has_previous_secret && sub.secret_rotated_at && (
                    <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#fff3cd', border: '1px solid #ffeeba', borderRadius: '4px', fontSize: '0.9em' }}>
                      <strong>Rotation Overlap Active</strong><br/>
                      Rotated at: {new Date(sub.secret_rotated_at).toLocaleString()}<br/>
                      Expires: {new Date(new Date(sub.secret_rotated_at).getTime() + 24 * 60 * 60 * 1000).toLocaleString()}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={async () => {
                    if (confirm('Rotate secret? This will invalidate the previous secret after 24 hours.')) {
                      setLoading(true);
                      await fetch(`${API_URL}/api/webhooks/${sub.id}/rotate-secret`, { method: 'POST' });
                      await fetchSubscriptions();
                    }
                  }}>Rotate Secret</button>
                  <button onClick={() => handleEdit(sub)}>Edit</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default WebhookSubscriptions
