import { FC, useState, useEffect, CSSProperties } from 'react'
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

function remittanceFromScVal(val: unknown): Remittance {
  const native = val as Record<string, unknown>
  const statusRaw = native['status'] as Record<string, unknown>
  const statusKey = Object.keys(statusRaw)[0] as RemittanceStatus

  // Extract memo: the contract stores it as an Option<String> (Some(text) or None/undefined).
  // scValToNative converts a Soroban Option<String> to either a string value or undefined/null.
  const rawMemo = native['memo']
  const memo: string | null =
    rawMemo != null && rawMemo !== '' ? String(rawMemo) : null

  return {
    id: Number(native['id'] as number),
    sender: (native['sender'] as { toString(): string }).toString(),
    agent: (native['agent'] as { toString(): string }).toString(),
    amount: Number(BigInt(native['amount'] as number)) / STROOPS_PER_USDC,
    fee: Number(BigInt(native['fee'] as number)) / STROOPS_PER_USDC,
    status: statusKey,
    memo,
  }
}

async function fetchRemittancesFromContract(contractId: string, walletAddress: string): Promise<Remittance[]> {
  const server = new SorobanRpc.Server(RPC_URL)
  const contract = new Contract(contractId)
  const account = await server.getAccount(walletAddress)

  const idsTx = new TransactionBuilder(account, {
    fee: '1000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'get_remittances_by_sender',
        nativeToScVal(Address.fromString(walletAddress), { type: 'address' }),
        nativeToScVal(BigInt(0), { type: 'u64' }),
        nativeToScVal(BigInt(50), { type: 'u64' }),
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
  const ids = (scValToNative(idsResult.retval) as number[]).map(BigInt)

  if (ids.length === 0) return []

  const remittances: Remittance[] = []
  for (const id of ids) {
    const tx = new TransactionBuilder(account, {
      fee: '1000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call('get_remittance', nativeToScVal(id, { type: 'u64' })))
      .setTimeout(30)
      .build()

    const sim = await server.simulateTransaction(tx)
    if (SorobanRpc.Api.isSimulationError(sim)) continue
    const result = (sim as SorobanRpc.Api.SimulateTransactionSuccessResponse).result
    if (!result) continue
    remittances.push(remittanceFromScVal(scValToNative(result.retval)))
  }

  return remittances.sort((a, b) => b.id - a.id)
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
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ id: number; amount: number } | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelResults, setCancelResults] = useState<Record<number, string>>({})
  const [cancelErrors, setCancelErrors] = useState<Record<number, string>>({})

  useEffect(() => {
    if (!contractId || !walletAddress) return

    let cancelled = false
    setLoading(true)
    setFetchError(null)

    fetchRemittancesFromContract(contractId, walletAddress)
      .then(data => {
        if (!cancelled) {
          setRemittances(data)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : 'Failed to fetch remittances')
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [contractId, walletAddress])

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
