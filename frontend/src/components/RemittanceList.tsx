import { FC, useState, useEffect, useCallback, useRef, CSSProperties } from 'react'
import { signTransaction } from '@stellar/freighter-api'
import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  Networks,
  nativeToScVal,
  scValToNative,
  Address,
} from '@stellar/stellar-sdk'

const RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK === 'mainnet'
  ? Networks.PUBLIC
  : Networks.TESTNET

const STROOPS_PER_USDC = 10_000_000

/** Number of remittance IDs to load per page (Load More press). */
const PAGE_SIZE = 20

/**
 * Maximum number of parallel RPC calls while fetching remittance details.
 * Kept small to avoid hitting rate limits on public Soroban RPC endpoints.
 */
const RPC_CONCURRENCY = 8

/**
 * How long (ms) a cached result is considered fresh.
 * Re-renders within this window reuse the cached list without any RPC calls.
 */
const CACHE_TTL_MS = 30_000

type RemittanceStatus = 'Pending' | 'Processing' | 'Completed' | 'Cancelled' | 'Failed' | 'Disputed'

interface Remittance {
  id: number
  sender: string
  agent: string
  amount: number
  fee: number
  status: RemittanceStatus
  memo: string | null
}

interface RemittanceListProps {
  walletAddress: string
  contractId: string
}

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Keyed by `${contractId}:${walletAddress}` so different accounts/contracts are
// independent.  Stores the full ordered list and expires after CACHE_TTL_MS.

interface CacheEntry {
  allIds: bigint[]
  remittances: Map<number, Remittance>
  fetchedAt: number
}

const remittanceCache = new Map<string, CacheEntry>()

function getCacheKey(contractId: string, walletAddress: string): string {
  return `${contractId}:${walletAddress}`
}

// ─── Concurrency limiter ──────────────────────────────────────────────────────

/**
 * Run `tasks` with at most `concurrency` in flight at once.
 * Returns results in input order (Promise.allSettled semantics per slot).
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<Array<PromiseSettledResult<T>>> {
  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length)
  let nextIdx = 0

  async function worker(): Promise<void> {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++
      try {
        results[idx] = { status: 'fulfilled', value: await tasks[idx]() }
      } catch (err) {
        results[idx] = { status: 'rejected', reason: err }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker)
  await Promise.all(workers)
  return results
}

// ─── RPC helpers ──────────────────────────────────────────────────────────────

function remittanceFromScVal(val: unknown): Remittance {
  const native = val as Record<string, unknown>
  const statusRaw = native['status'] as Record<string, unknown>
  const statusKey = Object.keys(statusRaw)[0] as RemittanceStatus
  return {
    id: Number(native['id'] as number),
    sender: (native['sender'] as { toString(): string }).toString(),
    agent: (native['agent'] as { toString(): string }).toString(),
    amount: Number(BigInt(native['amount'] as number)) / STROOPS_PER_USDC,
    fee: Number(BigInt(native['fee'] as number)) / STROOPS_PER_USDC,
    status: statusKey,
    memo: null,
  }
}

/**
 * Fetch all remittance IDs for a sender (one RPC call).
 * Uses a large enough limit so we get the complete ID list in one shot;
 * pagination over IDs is done locally in the component.
 */
async function fetchAllRemittanceIds(
  contractId: string,
  walletAddress: string,
): Promise<bigint[]> {
  const server = new SorobanRpc.Server(RPC_URL)
  const contract = new Contract(contractId)
  const account = await server.getAccount(walletAddress)

  // Request up to 1000 IDs in one call.  The contract caps at 100 per call, so
  // we use the maximum allowed page size and paginate if needed in the future.
  const idsTx = new TransactionBuilder(account, {
    fee: '1000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'get_remittances_by_sender',
        nativeToScVal(Address.fromString(walletAddress), { type: 'address' }),
        nativeToScVal(BigInt(0), { type: 'u64' }),
        nativeToScVal(BigInt(100), { type: 'u64' }),
      )
    )
    .setTimeout(30)
    .build()

  const idsSim = await server.simulateTransaction(idsTx)
  if (SorobanRpc.Api.isSimulationError(idsSim)) {
    throw new Error(`Simulation failed: ${idsSim.error}`)
  }
  const idsResult = (idsSim as SorobanRpc.Api.SimulateTransactionSuccessResponse).result
  if (!idsResult) throw new Error('No result from simulation')
  return (scValToNative(idsResult.retval) as number[]).map(BigInt)
}

/**
 * Fetch a single remittance by ID via contract simulation.
 * Returns null when the simulation fails so callers can skip the entry.
 */
async function fetchRemittanceById(
  server: SorobanRpc.Server,
  account: Awaited<ReturnType<SorobanRpc.Server['getAccount']>>,
  contract: Contract,
  id: bigint,
): Promise<Remittance | null> {
  const tx = new TransactionBuilder(account, {
    fee: '1000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('get_remittance', nativeToScVal(id, { type: 'u64' })))
    .setTimeout(30)
    .build()

  const sim = await server.simulateTransaction(tx)
  if (SorobanRpc.Api.isSimulationError(sim)) return null
  const result = (sim as SorobanRpc.Api.SimulateTransactionSuccessResponse).result
  if (!result) return null
  return remittanceFromScVal(scValToNative(result.retval))
}

/**
 * Fetch remittance details for a slice of IDs in parallel.
 *
 * - Checks the cache first; only issues RPC calls for IDs not yet cached.
 * - Parallelises up to RPC_CONCURRENCY calls simultaneously.
 * - Skips IDs whose simulation fails (network error, expired entry) rather
 *   than aborting the whole page.
 */
async function fetchRemittanceDetails(
  contractId: string,
  walletAddress: string,
  ids: bigint[],
  cacheEntry: CacheEntry,
): Promise<Remittance[]> {
  const server = new SorobanRpc.Server(RPC_URL)
  const contract = new Contract(contractId)
  const account = await server.getAccount(walletAddress)

  const uncachedIds = ids.filter((id) => !cacheEntry.remittances.has(Number(id)))

  const tasks = uncachedIds.map((id) => () =>
    fetchRemittanceById(server, account, contract, id)
  )

  const settled = await runWithConcurrency(tasks, RPC_CONCURRENCY)
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value !== null) {
      cacheEntry.remittances.set(result.value.id, result.value)
    } else if (result.status === 'rejected') {
      console.warn(`[RemittanceList] Failed to fetch remittance ${uncachedIds[i]}:`, result.reason)
    }
  })

  return ids
    .map((id) => cacheEntry.remittances.get(Number(id)))
    .filter((r): r is Remittance => r !== undefined)
    .sort((a, b) => b.id - a.id)
}

async function cancelRemittance(contractId: string, remittanceId: number, senderPublicKey: string): Promise<string> {
  const server = new SorobanRpc.Server(RPC_URL)
  const account = await server.getAccount(senderPublicKey)
  const contract = new Contract(contractId)

  const tx = new TransactionBuilder(account, {
    fee: '1000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call('cancel_remittance', nativeToScVal(remittanceId, { type: 'u64' }))
    )
    .setTimeout(30)
    .build()

  const simulated = await server.simulateTransaction(tx)
  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`)
  }

  const prepared = SorobanRpc.assembleTransaction(tx, simulated).build()
  const { signedTxXdr, error } = await signTransaction(prepared.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  })
  if (error) throw new Error(error.message || 'Freighter signing failed')

  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE)
  const result = await server.sendTransaction(signedTx)
  return result.hash
}

const RemittanceList: FC<RemittanceListProps> = ({ walletAddress, contractId }) => {
  const [remittances, setRemittances] = useState<Remittance[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ id: number; amount: number } | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelResults, setCancelResults] = useState<Record<number, string>>({})
  const [cancelErrors, setCancelErrors] = useState<Record<number, string>>({})
  // Pagination state
  const [pageOffset, setPageOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const allIdsRef = useRef<bigint[]>([])

  const load = useCallback(async (reset: boolean) => {
    if (!contractId || !walletAddress) return

    const cacheKey = getCacheKey(contractId, walletAddress)
    const now = Date.now()

    // On reset (initial load / refresh): fetch fresh ID list
    if (reset) {
      setLoading(true)
      setFetchError(null)
      setRemittances([])
      setPageOffset(0)
      setHasMore(false)

      try {
        // Check if the full cache is still fresh — skip the ID fetch too
        const cached = remittanceCache.get(cacheKey)
        let allIds: bigint[]

        if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
          allIds = cached.allIds
        } else {
          allIds = await fetchAllRemittanceIds(contractId, walletAddress)
          // Create or reset the cache entry; detail entries are preserved if
          // the cache was already populated (avoids re-fetching known details).
          const existing = remittanceCache.get(cacheKey)
          remittanceCache.set(cacheKey, {
            allIds,
            remittances: existing?.remittances ?? new Map(),
            fetchedAt: now,
          })
        }

        allIdsRef.current = allIds
        const pageIds = allIds.slice(0, PAGE_SIZE)
        const cacheEntry = remittanceCache.get(cacheKey)!

        const details = await fetchRemittanceDetails(contractId, walletAddress, pageIds, cacheEntry)
        setRemittances(details)
        setPageOffset(PAGE_SIZE)
        setHasMore(allIds.length > PAGE_SIZE)
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : 'Failed to fetch remittances')
      } finally {
        setLoading(false)
      }
    } else {
      // Load More: fetch the next page of IDs using already-fetched allIds
      setLoadingMore(true)
      try {
        const allIds = allIdsRef.current
        const nextOffset = pageOffset
        const pageIds = allIds.slice(nextOffset, nextOffset + PAGE_SIZE)
        const cacheEntry = remittanceCache.get(cacheKey)

        if (!cacheEntry) return

        const details = await fetchRemittanceDetails(contractId, walletAddress, pageIds, cacheEntry)
        setRemittances((prev) => {
          // Merge: replace any updated entries and append new ones
          const byId = new Map(prev.map((r) => [r.id, r]))
          details.forEach((r) => byId.set(r.id, r))
          return Array.from(byId.values()).sort((a, b) => b.id - a.id)
        })
        setPageOffset(nextOffset + PAGE_SIZE)
        setHasMore(allIds.length > nextOffset + PAGE_SIZE)
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : 'Failed to load more remittances')
      } finally {
        setLoadingMore(false)
      }
    }
  }, [contractId, walletAddress, pageOffset])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!contractId || !walletAddress) return
      const cacheKey = getCacheKey(contractId, walletAddress)
      const now = Date.now()
      const cached = remittanceCache.get(cacheKey)

      // Serve from cache if fresh — no RPC calls at all
      if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
        const pageIds = cached.allIds.slice(0, PAGE_SIZE)
        const details = await fetchRemittanceDetails(contractId, walletAddress, pageIds, cached)
        if (!cancelled) {
          allIdsRef.current = cached.allIds
          setRemittances(details)
          setPageOffset(PAGE_SIZE)
          setHasMore(cached.allIds.length > PAGE_SIZE)
        }
        return
      }
      if (!cancelled) load(true)
    }
    run()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId, walletAddress])

  const handleLoadMore = () => {
    load(false)
  }

  const getStatusColor = (status: Remittance['status']): string => {
    switch (status) {
      case 'Pending': return '#ffa500'
      case 'Processing': return '#2196f3'
      case 'Completed': return '#4caf50'
      case 'Cancelled': return '#f44336'
      case 'Failed': return '#e91e63'
      case 'Disputed': return '#ff5722'
      default: return '#666'
    }
  }

  const openCancelDialog = (remittance: Remittance): void => {
    setConfirmDialog({ id: remittance.id, amount: remittance.amount })
    setCancelErrors(prev => ({ ...prev, [remittance.id]: '' }))
  }

  const handleConfirmCancel = async (): Promise<void> => {
    if (!confirmDialog) return
    const { id } = confirmDialog
    setCancelling(true)
    setCancelErrors(prev => ({ ...prev, [id]: '' }))

    try {
      const txHash = await cancelRemittance(contractId, id, walletAddress)
      setCancelResults(prev => ({ ...prev, [id]: txHash }))
      setRemittances(prev => prev.map(r =>
        r.id === id ? { ...r, status: 'Cancelled' as const } : r
      ))
      // Evict from cache so next reload reflects the cancellation
      const cacheKey = getCacheKey(contractId, walletAddress)
      const cacheEntry = remittanceCache.get(cacheKey)
      if (cacheEntry) {
        const updated = cacheEntry.remittances.get(id)
        if (updated) cacheEntry.remittances.set(id, { ...updated, status: 'Cancelled' })
      }
      setConfirmDialog(null)
    } catch (err) {
      setCancelErrors(prev => ({ ...prev, [id]: (err instanceof Error ? err.message : String(err)) || 'Failed to cancel' }))
    } finally {
      setCancelling(false)
    }
  }

  if (!contractId) {
    return null
  }

  return (
    <div className="panel remittance-list">
      <h2>Your Remittances</h2>

      {loading && <p>Loading...</p>}

      {fetchError && (
        <div className="error" style={{ marginBottom: 12 }}>
          {fetchError}
        </div>
      )}

      {!loading && !fetchError && remittances.length === 0 && (
        <p className="hint">No remittances found</p>
      )}

      {!loading && remittances.length > 0 && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Agent</th>
                <th>Amount</th>
                <th>Fee</th>
                <th>Status</th>
                <th>Memo</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {remittances.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.agent.slice(0, 8)}...{r.agent.slice(-8)}</td>
                  <td>${r.amount.toFixed(2)}</td>
                  <td>${r.fee.toFixed(2)}</td>
                  <td>
                    <span
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(r.status) } as CSSProperties}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td>{r.memo || <span style={{ color: '#aaa' }}>—</span>}</td>
                  <td>
                    {r.status === 'Pending' && !cancelResults[r.id] && (
                      <button
                        onClick={() => openCancelDialog(r)}
                        style={{
                          background: '#c0392b',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          padding: '4px 10px',
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        Cancel
                      </button>
                    )}
                    {cancelResults[r.id] && (
                      <span style={{ color: '#4caf50', fontSize: 12 }}>
                        Refunded ✓
                      </span>
                    )}
                    {cancelErrors[r.id] && (
                      <span style={{ color: '#f44336', fontSize: 12 }}>
                        {cancelErrors[r.id]}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && !loading && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            style={{
              background: '#2196f3',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '8px 20px',
              cursor: loadingMore ? 'not-allowed' : 'pointer',
              fontSize: 14,
              opacity: loadingMore ? 0.7 : 1,
            }}
          >
            {loadingMore ? 'Loading…' : `Load More (${allIdsRef.current.length - pageOffset} remaining)`}
          </button>
        </div>
      )}

      {Object.entries(cancelResults).map(([id, txHash]) => (
        <div key={id} className="success" style={{ marginTop: 8, fontSize: 13 }}>
          Remittance #{id} cancelled — refund tx: <code>{txHash}</code>
        </div>
      ))}

      {confirmDialog && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          } as CSSProperties}
        >
          <div
            style={{
              background: '#1e1e2e', borderRadius: 8, padding: 24,
              maxWidth: 400, width: '90%', boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            } as CSSProperties}
          >
            <h3 style={{ marginTop: 0 }}>Cancel Remittance #{confirmDialog.id}?</h3>
            <p>
              You will receive a full refund of{' '}
              <strong>${confirmDialog.amount.toFixed(2)} USDC</strong>.
            </p>
            <p style={{ color: '#ffa500', fontSize: 13 }}>
              ⚠ This action is irreversible. The remittance will be cancelled and funds returned to your wallet.
            </p>

            {cancelErrors[confirmDialog.id] && (
              <div className="error" style={{ marginBottom: 12 }}>
                {cancelErrors[confirmDialog.id]}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDialog(null)}
                disabled={cancelling}
                style={{
                  background: 'transparent', border: '1px solid #555',
                  color: '#ccc', borderRadius: 4, padding: '8px 16px', cursor: 'pointer',
                }}
              >
                Keep
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={cancelling}
                style={{
                  background: '#c0392b', color: '#fff', border: 'none',
                  borderRadius: 4, padding: '8px 16px', cursor: 'pointer',
                }}
              >
                {cancelling ? 'Cancelling...' : 'Confirm Cancel & Refund'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default RemittanceList
