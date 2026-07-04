import { FC, useState, useEffect, FormEvent } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

const KYC_COLORS: Record<string, string> = { approved: '#38a169', pending: '#d69e2e', rejected: '#e53e3e', expired: '#718096' }

interface Agent {
  address: string
  kyc_status?: string
  kyc_expires_at?: string
  success_rate?: number
  total_volume?: number
  last_active?: string
  active_remittances?: number
}

interface RemoveConfirm {
  address: string
  hasActive: boolean
}

const AgentManagement: FC = () => {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newAddress, setNewAddress] = useState('')
  const [registering, setRegistering] = useState(false)
  const [removeConfirm, setRemoveConfirm] = useState<RemoveConfirm | null>(null)

  useEffect(() => { fetchAgents() }, [])

  async function fetchAgents(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/agents`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setAgents(await res.json())
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) || 'Failed to fetch agents')
      setAgents([])
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (!newAddress.trim()) return
    setRegistering(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: newAddress.trim() }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setNewAddress('')
      await fetchAgents()
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) || 'Failed to register agent')
    } finally {
      setRegistering(false)
    }
  }

  async function initiateRemove(agent: Agent): Promise<void> {
    let hasActive = false
    try {
      const res = await fetch(`${API_URL}/api/agents/${agent.address}/remittances?status=active`)
      if (res.ok) {
        const data: Agent[] | { count: number } = await res.json()
        hasActive = Array.isArray(data) ? data.length > 0 : (data.count ?? 0) > 0
      }
    } catch {
      // proceed with warning unknown
    }
    setRemoveConfirm({ address: agent.address, hasActive })
  }

  async function confirmRemove(): Promise<void> {
    if (!removeConfirm) return
    const { address } = removeConfirm
    setRemoveConfirm(null)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/agents/${address}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await fetchAgents()
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)) || 'Failed to remove agent')
    }
  }

  return (
    <div className="panel" role="main" aria-label="Agent Management">
      <h2>Agent Management</h2>

      {removeConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-confirm-title"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', maxWidth: '420px', width: '90%' }}>
            <h3 id="remove-confirm-title">Remove Agent</h3>
            <p style={{ margin: '12px 0', wordBreak: 'break-all' }}>
              Remove agent <strong>{removeConfirm.address}</strong>?
            </p>
            {removeConfirm.hasActive && (
              <div className="error" role="alert" style={{ marginBottom: '12px' }}>
                ⚠️ This agent has in-flight remittances. Removing them may disrupt active transfers.
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setRemoveConfirm(null)}>Cancel</button>
              <button
                onClick={confirmRemove}
                style={{ background: '#e53e3e', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 16px', cursor: 'pointer' }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleRegister} aria-label="Register new agent">
        <div className="form-group">
          <label htmlFor="agent-address">Agent Stellar Address</label>
          <input
            id="agent-address"
            type="text"
            value={newAddress}
            onChange={e => setNewAddress(e.target.value)}
            placeholder="G..."
            required
            style={{ fontFamily: 'monospace' }}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={registering}>
          {registering ? 'Registering…' : 'Register Agent'}
        </button>
      </form>

      {error && <div className="error" role="alert">{error}</div>}

      <hr style={{ margin: '24px 0' }} />

      {loading ? (
        <p aria-live="polite">Loading…</p>
      ) : agents.length === 0 ? (
        <p>No registered agents.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }} aria-label="Agent list">
          {agents.map(agent => (
            <li
              key={agent.address}
              style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}
              aria-label={`Agent ${agent.address}`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <code style={{ fontSize: '0.85rem', wordBreak: 'break-all' }}>{agent.address}</code>
                  <div style={{ marginTop: '6px', display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                    <span>
                      KYC:{' '}
                      <strong style={{ color: KYC_COLORS[agent.kyc_status || ''] || '#718096' }}>
                        {agent.kyc_status ?? 'unknown'}
                      </strong>
                    </span>
                    {agent.kyc_expires_at && (
                      <span style={{ color: '#718096' }}>
                        Expires: {new Date(agent.kyc_expires_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: '6px', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '0.8rem', color: '#555' }}>
                    <span>Success rate: {agent.success_rate != null ? `${agent.success_rate}%` : '—'}</span>
                    <span>Volume: {agent.total_volume != null ? `${agent.total_volume} USDC` : '—'}</span>
                    <span>
                      Last active:{' '}
                      {agent.last_active ? new Date(agent.last_active).toLocaleString() : '—'}
                    </span>
                    <span>Active remittances: {agent.active_remittances ?? '—'}</span>
                  </div>
                </div>
                <button
                  onClick={() => initiateRemove(agent)}
                  aria-label={`Remove agent ${agent.address}`}
                  style={{ color: '#e53e3e', whiteSpace: 'nowrap' }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default AgentManagement
