import { FC, useState, useEffect, useCallback } from 'react'

const AUTO_REFRESH_MS = 60_000

const PAUSE_REASON_LABELS: Record<string, string> = {
  SecurityIncident: 'Security Incident',
  SuspiciousActivity: 'Suspicious Activity',
  MaintenanceWindow: 'Maintenance Window',
  ExternalThreat: 'External Threat',
}

interface HealthStatus {
  initialized: boolean
  paused: boolean
  admin_count: number
  total_remittances: number
  accumulated_fees: number
  pause_reason?: string
}

interface ContractHealthProps {
  walletAddress?: string
  contractId: string
  onPausedChange?: (isPaused: boolean) => void
}

const ContractHealth: FC<ContractHealthProps> = ({ walletAddress, contractId, onPausedChange }) => {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawResult, setWithdrawResult] = useState<string | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const fetchHealth = useCallback(async (): Promise<void> => {
    if (!contractId) return
    setLoading(true)
    setError(null)
    try {
      const apiBase = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${apiBase}/api/contract/health?contractId=${encodeURIComponent(contractId)}`)
      if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
      const data: HealthStatus = await res.json()
      setHealth(data)
      setLastChecked(new Date())
      if (data.paused) setBannerDismissed(false)
      onPausedChange?.(data.paused)
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)) || 'Failed to fetch contract health')
    } finally {
      setLoading(false)
    }
  }, [contractId, onPausedChange])

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, AUTO_REFRESH_MS)
    return () => clearInterval(interval)
  }, [fetchHealth])

  const handleWithdraw = async (): Promise<void> => {
    setWithdrawing(true)
    setError(null)
    try {
      const apiBase = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${apiBase}/api/contract/fees/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId }),
      })
      if (!res.ok) throw new Error(`Withdrawal failed: ${res.status}`)
      const { txHash }: { txHash: string } = await res.json()
      setWithdrawResult(txHash)
      await fetchHealth()
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)) || 'Failed to withdraw fees')
    } finally {
      setWithdrawing(false)
    }
  }

  if (!contractId) return null

  return (
    <div style={{ padding: '16px', border: '1px solid #ddd', borderRadius: '8px', marginBottom: '16px' }}>
      <h3 style={{ marginTop: 0 }}>Contract Health</h3>

      {health && health.paused && !bannerDismissed && (
        <div
          role="alert"
          style={{
            background: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '4px',
            padding: '12px',
            marginBottom: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <strong>⚠️ Contract Paused</strong>
            <p style={{ margin: '4px 0 0', fontSize: '0.9em' }}>
              Reason: {PAUSE_REASON_LABELS[health.pause_reason || ''] || 'Unknown'}
            </p>
          </div>
          <button onClick={() => setBannerDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2em' }}>
            ✕
          </button>
        </div>
      )}

      {loading && <p>Checking health…</p>}
      {error && <p style={{ color: '#d32f2f' }}>{error}</p>}

      {health && (
        <div style={{ fontSize: '0.9em', lineHeight: '1.6' }}>
          <p><strong>Status:</strong> {health.initialized ? '✓ Initialized' : '✗ Not initialized'}</p>
          <p><strong>Paused:</strong> {health.paused ? '🔴 Yes' : '🟢 No'}</p>
          <p><strong>Admins:</strong> {health.admin_count}</p>
          <p><strong>Total Remittances:</strong> {health.total_remittances}</p>
          <p><strong>Accumulated Fees:</strong> {(health.accumulated_fees / 10_000_000).toFixed(2)} USDC</p>
          {lastChecked && <p><small style={{ color: '#999' }}>Last checked: {lastChecked.toLocaleTimeString()}</small></p>}
        </div>
      )}

      {walletAddress && health && health.accumulated_fees > 0 && (
        <button
          onClick={handleWithdraw}
          disabled={withdrawing}
          style={{
            marginTop: '12px',
            padding: '8px 16px',
            background: '#1976d2',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          {withdrawing ? 'Withdrawing…' : 'Withdraw Fees'}
        </button>
      )}

      {withdrawResult && (
        <p style={{ color: '#388e3c', marginTop: '8px', fontSize: '0.9em' }}>
          ✓ Withdrawal successful: <code>{withdrawResult}</code>
        </p>
      )}
    </div>
  )
}

export default ContractHealth
