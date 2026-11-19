import { FC, useState, useEffect, useCallback } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { usePolling } from '../utils/usePolling'

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

// Mirrors the on-chain `ContractConfig` struct returned by the `get_config` view.
interface ContractConfig {
  platform_fee_bps: number
  protocol_fee_bps: number
  dispute_window: number
  processing_timeout: number
  escrow_ttl: number
  rate_limit_config: {
    max_requests: number
    window_seconds: number
  }
  min_agent_reputation: number
  cooldown_period: number
  treasury: string
  oracle: string
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
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false)
  const [config, setConfig] = useState<ContractConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)

  const fetchHealth = useCallback(async (): Promise<boolean> => {
    if (!contractId) return false
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
      return true
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)) || 'Failed to fetch contract health')
      return false
    } finally {
      setLoading(false)
    }
  }, [contractId, onPausedChange])

  // Fetch every admin-tunable parameter in a single `get_config` call.
  const fetchConfig = useCallback(async (): Promise<boolean> => {
    if (!contractId) return false
    setConfigError(null)
    try {
      const apiBase = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${apiBase}/api/contract/config?contractId=${encodeURIComponent(contractId)}`)
      if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`)
      const data: ContractConfig = await res.json()
      setConfig(data)
      return true
    } catch (err) {
      setConfigError((err instanceof Error ? err.message : String(err)) || 'Failed to fetch contract config')
      return false
    }
  }, [contractId])

  useEffect(() => {
    fetchHealth()
    fetchConfig()
  }, [fetchHealth, fetchConfig])

  // Refresh in the background; pauses while the tab is hidden and backs off on errors.
  usePolling(fetchHealth, { intervalMs: AUTO_REFRESH_MS, enabled: !!contractId })
  usePolling(fetchConfig, { intervalMs: AUTO_REFRESH_MS, enabled: !!contractId })

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

      {configError && <p style={{ color: '#d32f2f' }}>{configError}</p>}

      {config && (
        <div style={{ marginTop: '12px', fontSize: '0.9em', lineHeight: '1.6' }}>
          <h4 style={{ margin: '0 0 8px' }}>Configuration</h4>
          <p><strong>Platform Fee:</strong> {config.platform_fee_bps} bps</p>
          <p><strong>Protocol Fee:</strong> {config.protocol_fee_bps} bps</p>
          <p><strong>Dispute Window:</strong> {config.dispute_window}s</p>
          <p><strong>Processing Timeout:</strong> {config.processing_timeout}s</p>
          <p><strong>Escrow TTL:</strong> {config.escrow_ttl}s</p>
          <p>
            <strong>Rate Limit:</strong> {config.rate_limit_config.max_requests} requests /{' '}
            {config.rate_limit_config.window_seconds}s
          </p>
          <p><strong>Min Agent Reputation:</strong> {config.min_agent_reputation}</p>
          <p><strong>Cooldown Period:</strong> {config.cooldown_period}s</p>
          <p><strong>Treasury:</strong> <code>{config.treasury}</code></p>
          <p><strong>Oracle:</strong> <code>{config.oracle}</code></p>
        </div>
      )}

      {walletAddress && health && health.accumulated_fees > 0 && (
        <button
          onClick={() => setShowWithdrawConfirm(true)}
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

      <ConfirmDialog
        open={showWithdrawConfirm}
        title="Withdraw Accumulated Fees"
        message={`You are about to withdraw ${(health?.accumulated_fees ?? 0 / 10_000_000).toFixed(2)} USDC in accumulated protocol fees. This will initiate an on-chain transaction. Continue?`}
        confirmLabel="Withdraw Fees"
        danger
        onConfirm={() => {
          setShowWithdrawConfirm(false)
          handleWithdraw()
        }}
        onCancel={() => setShowWithdrawConfirm(false)}
      />

      {withdrawResult && (
        <p style={{ color: '#388e3c', marginTop: '8px', fontSize: '0.9em' }}>
          ✓ Withdrawal successful: <code>{withdrawResult}</code>
        </p>
      )}
    </div>
  )
}

export default ContractHealth
