import { useState, useEffect } from 'react'
import { signTransaction } from '@stellar/freighter-api'
import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  nativeToScVal,
} from '@stellar/stellar-sdk'

const RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK === 'mainnet'
  ? Networks.PUBLIC
  : Networks.TESTNET

async function cancelRemittance(contractId, remittanceId, senderPublicKey) {
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

export default function RemittanceList({ walletAddress, contractId }) {
  const [remittances, setRemittances] = useState([])
  const [loading, setLoading] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null) // { id, amount }
  const [cancelling, setCancelling] = useState(false)
  const [cancelResults, setCancelResults] = useState({}) // { [id]: txHash }
  const [cancelErrors, setCancelErrors] = useState({})   // { [id]: message }

  useEffect(() => {
    if (contractId && walletAddress) {
      // In production, fetch from contract
      setRemittances([
        {
          id: 1,
          sender: walletAddress,
          agent: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          amount: 100.00,
          fee: 2.50,
          status: 'Pending',
          memo: null,
        }
      ])
    }
  }, [contractId, walletAddress])

  const getStatusColor = (status) => {
    switch (status) {
      case 'Pending': return '#ffa500'
      case 'Completed': return '#4caf50'
      case 'Cancelled': return '#f44336'
      default: return '#666'
    }
  }

  const openCancelDialog = (remittance) => {
    setConfirmDialog({ id: remittance.id, amount: remittance.amount })
    setCancelErrors(prev => ({ ...prev, [remittance.id]: null }))
  }

  const handleConfirmCancel = async () => {
    if (!confirmDialog) return
    const { id, amount } = confirmDialog
    setCancelling(true)
    setCancelErrors(prev => ({ ...prev, [id]: null }))

    try {
      const txHash = await cancelRemittance(contractId, id, walletAddress)
      setCancelResults(prev => ({ ...prev, [id]: txHash }))
      setRemittances(prev => prev.map(r =>
        r.id === id ? { ...r, status: 'Cancelled' } : r
      ))
      setConfirmDialog(null)
    } catch (err) {
      setCancelErrors(prev => ({ ...prev, [id]: err.message }))
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

      {!loading && remittances.length === 0 && (
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
                      style={{ backgroundColor: getStatusColor(r.status) }}
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

      {/* Refund tx hash display */}
      {Object.entries(cancelResults).map(([id, txHash]) => (
        <div key={id} className="success" style={{ marginTop: 8, fontSize: 13 }}>
          Remittance #{id} cancelled — refund tx: <code>{txHash}</code>
        </div>
      ))}

      {/* Confirmation dialog */}
      {confirmDialog && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#1e1e2e', borderRadius: 8, padding: 24,
              maxWidth: 400, width: '90%', boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            }}
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
