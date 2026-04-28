import { useState, useEffect, useCallback } from 'react'

const AUTO_REFRESH_MS = 60_000

const PAUSE_REASON_LABELS = {
  SecurityIncident: 'Security Incident',
  SuspiciousActivity: 'Suspicious Activity',
  MaintenanceWindow: 'Maintenance Window',
  ExternalThreat: 'External Threat',
}

/**
 * ContractHealth widget — polls the contract's health() function and displays
 * initialized status, pause state, admin count, total remittances, and
 * accumulated fees. Includes a withdraw fees button for admins.
 *
 * Props:
 *   walletAddress  — connected wallet address (optional)
 *   contractId     — deployed contract ID
 *   onPausedChange — callback(isPaused: boolean) fired whenever pause state changes
 */
export default function ContractHealth({ walletAddress, contractId, onPausedChange }) {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastChecked, setLastChecked] = useState(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawResult, setWithdrawResult] = useState(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const fetchHealth = useCallback(async () => {
    if (!contractId) return
    setLoading(true)
    setError(null)
    try {
      const apiBase = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${apiBase}/api/contract/health?contractId=${encodeURIComponent(contractId)}`)
      if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
      const data = await res.json()
      setHealth(data)
      setLastChecked(new Date())
      // Re-show banner on next poll if still paused
      if (data.paused) setBannerDismissed(false)
      onPausedChange?.(data.paused)
    } catch (err) {
      setError(err.message || 'Failed to fetch contract health')
    } finally {
      setLoading(false)
    }
  }, [contractId, onPausedChange])

  // Initial fetch + auto-refresh every 60 s
  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, AUTO_REFRESH_MS)
    return () => clearInterval(interval)
  }, [fetchHealth])

  const handleWithdrawFees = async () => {
    if (!walletAddress || !contractId) return
    setWithdrawing(true)
    setWithdrawResult(null)
    try {
      const apiBase = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${apiBase}/api/contract/withdraw-fees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId, to: walletAddress }),
      })
      if (!res.ok) throw new Error(`Withdraw failed: ${res.status}`)
      const data = await res.json()
      setWithdrawResult(data.message || 'Fees withdrawn successfully')
      fetchHealth()
    } catch (err) {
      setWithdrawResult(`Error: ${err.message}`)
    } finally {
      setWithdrawing(false)
    }
  }

  if (!contractId) {
    return (
      <div className="panel">
        <h2>Contract Health</h2>
        <p className="hint">Enter a contract ID above to view health status.</p>
      </div>
    )
  }

  const pauseReasonLabel = health?.pause_reason
    ? (PAUSE_REASON_LABELS[health.pause_reason] ?? health.pause_reason)
    : null

  return (
    <div className="panel">
      {/* Prominent pause banner — shown outside the panel when paused and not dismissed */}
      {health?.paused && !bannerDismissed && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '14px 18px',
            marginBottom: '16px',
            borderRadius: '8px',
            background: '#fef2f2',
            border: '2px solid #ef4444',
            color: '#b91c1c',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>🔴</span>
            <div>
              <strong>Service temporarily paused{pauseReasonLabel ? `: ${pauseReasonLabel}` : ''}</strong>
              <p style={{ margin: '2px 0 0', fontSize: '0.85rem' }}>
                Transaction submission is disabled until the service resumes.
              </p>
            </div>
          </div>
          <button
            aria-label="Dismiss pause banner"
            onClick={() => setBannerDismissed(true)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1.2rem',
              color: '#b91c1c',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Contract Health</h2>
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="btn-secondary"
          style={{ fontSize: '0.8rem', padding: '4px 10px' }}
        >
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {health && (
        <div className="health-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
          {/* Pause state — shown prominently */}
          <div
            className={`health-card ${health.paused ? 'health-paused' : 'health-active'}`}
            style={{
              gridColumn: '1 / -1',
              padding: '12px 16px',
              borderRadius: '8px',
              background: health.paused ? '#fee2e2' : '#dcfce7',
              border: `2px solid ${health.paused ? '#ef4444' : '#22c55e'}`,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span style={{ fontSize: '1.5rem' }}>{health.paused ? '🔴' : '🟢'}</span>
            <div>
              <strong style={{ color: health.paused ? '#b91c1c' : '#15803d' }}>
                {health.paused ? 'CONTRACT PAUSED' : 'Contract Active'}
              </strong>
              {health.paused && (
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#b91c1c' }}>
                  {pauseReasonLabel
                    ? `Reason: ${pauseReasonLabel}. All operations are temporarily disabled.`
                    : 'All operations are temporarily disabled.'}
                </p>
              )}
            </div>
          </div>

          <HealthStat label="Initialized" value={health.initialized ? 'Yes' : 'No'} />
          <HealthStat label="Admin Count" value={health.admin_count ?? '—'} />
          <HealthStat label="Total Remittances" value={health.total_remittances ?? '—'} />
          <HealthStat
            label="Accumulated Fees"
            value={health.accumulated_fees != null ? `${health.accumulated_fees} stroops` : '—'}
          />
        </div>
      )}

      {health && (
        <div style={{ marginTop: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleWithdrawFees}
            disabled={withdrawing || !walletAddress || !health.accumulated_fees || health.paused}
            className="btn-primary"
          >
            {withdrawing ? 'Withdrawing…' : 'Withdraw Fees'}
          </button>
          {lastChecked && (
            <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
              Last checked: {lastChecked.toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {withdrawResult && (
        <div className={withdrawResult.startsWith('Error') ? 'error' : 'success'} style={{ marginTop: '8px' }}>
          {withdrawResult}
        </div>
      )}
    </div>
  )
}

function HealthStat({ label, value }) {
  return (
    <div style={{
      padding: '10px 14px',
      borderRadius: '6px',
      background: '#f9fafb',
      border: '1px solid #e5e7eb',
    }}>
      <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: '1rem' }}>{String(value)}</div>
    </div>
  )
}
