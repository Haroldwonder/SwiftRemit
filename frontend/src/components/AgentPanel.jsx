import { useState, useEffect } from 'react'
import { getAddress, signTransaction } from '@stellar/freighter-api'
import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk'

const RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK === 'mainnet'
  ? Networks.PUBLIC
  : Networks.TESTNET

// Mock remittances for demonstration — in production fetch from contract/API
const MOCK_REMITTANCES = [
  { id: 1, sender: 'GABC...XYZ', amount: 100.00, fee: 2.50, status: 'Pending' },
  { id: 2, sender: 'GDEF...UVW', amount: 250.00, fee: 6.25, status: 'Pending' },
]

async function buildAndSignTx(contractId, method, args, agentPublicKey) {
  const server = new SorobanRpc.Server(RPC_URL)
  const account = await server.getAccount(agentPublicKey)
  const contract = new Contract(contractId)

  const tx = new TransactionBuilder(account, {
    fee: '1000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
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

export default function AgentPanel({ walletAddress, contractId }) {
  const [remittances, setRemittances] = useState([])
  const [agentKey, setAgentKey] = useState(walletAddress || '')
  const [proofInputs, setProofInputs] = useState({})
  const [failReasons, setFailReasons] = useState({})
  const [loading, setLoading] = useState({})
  const [results, setResults] = useState({})
  const [errors, setErrors] = useState({})
  const [walletConnected, setWalletConnected] = useState(!!walletAddress)

  useEffect(() => {
    if (agentKey && contractId) {
      // In production: fetch from contract filtered by agent address
      setRemittances(MOCK_REMITTANCES)
    }
  }, [agentKey, contractId])

  const connectWallet = async () => {
    try {
      const { address, error } = await getAddress()
      if (error) throw new Error(error.message || 'Failed to get address')
      setAgentKey(address)
      setWalletConnected(true)
    } catch (err) {
      setErrors(prev => ({ ...prev, wallet: err.message }))
    }
  }

  const handleConfirmPayout = async (remittanceId) => {
    if (!contractId) return
    setLoading(prev => ({ ...prev, [remittanceId]: 'confirm' }))
    setErrors(prev => ({ ...prev, [remittanceId]: null }))
    setResults(prev => ({ ...prev, [remittanceId]: null }))

    try {
      const proof = proofInputs[remittanceId] || ''
      const proofArg = proof
        ? nativeToScVal(proof, { type: 'string' })
        : xdr.ScVal.scvVoid()

      const txHash = await buildAndSignTx(
        contractId,
        'confirm_payout',
        [nativeToScVal(remittanceId, { type: 'u64' }), proofArg],
        agentKey
      )

      setResults(prev => ({ ...prev, [remittanceId]: { type: 'confirm', txHash } }))
      setRemittances(prev => prev.map(r =>
        r.id === remittanceId ? { ...r, status: 'Completed' } : r
      ))
    } catch (err) {
      setErrors(prev => ({ ...prev, [remittanceId]: err.message }))
    } finally {
      setLoading(prev => ({ ...prev, [remittanceId]: null }))
    }
  }

  const handleMarkFailed = async (remittanceId) => {
    if (!contractId) return
    setLoading(prev => ({ ...prev, [remittanceId]: 'fail' }))
    setErrors(prev => ({ ...prev, [remittanceId]: null }))
    setResults(prev => ({ ...prev, [remittanceId]: null }))

    try {
      const txHash = await buildAndSignTx(
        contractId,
        'mark_failed',
        [nativeToScVal(remittanceId, { type: 'u64' })],
        agentKey
      )

      setResults(prev => ({ ...prev, [remittanceId]: { type: 'fail', txHash } }))
      setRemittances(prev => prev.map(r =>
        r.id === remittanceId ? { ...r, status: 'Failed' } : r
      ))
    } catch (err) {
      setErrors(prev => ({ ...prev, [remittanceId]: err.message }))
    } finally {
      setLoading(prev => ({ ...prev, [remittanceId]: null }))
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'Pending': return '#ffa500'
      case 'Completed': return '#4caf50'
      case 'Failed': return '#f44336'
      default: return '#666'
    }
  }

  if (!walletConnected) {
    return (
      <div className="panel">
        <h2>Agent Panel</h2>
        <p className="hint">Connect your Freighter wallet to manage remittances</p>
        <button className="btn-primary" onClick={connectWallet}>
          Connect Freighter Wallet
        </button>
        {errors.wallet && <div className="error">{errors.wallet}</div>}
      </div>
    )
  }

  if (!contractId) {
    return (
      <div className="panel">
        <h2>Agent Panel</h2>
        <p className="hint">No contract ID configured</p>
      </div>
    )
  }

  const activeRemittances = remittances.filter(r =>
    r.status === 'Pending' || r.status === 'Processing'
  )

  return (
    <div className="panel">
      <h2>Agent Panel</h2>
      <p className="hint">
        Agent: <code>{agentKey.slice(0, 8)}...{agentKey.slice(-8)}</code>
      </p>

      {activeRemittances.length === 0 && (
        <p className="hint">No pending remittances assigned to you</p>
      )}

      {activeRemittances.map((r) => (
        <div key={r.id} style={{ border: '1px solid #333', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>Remittance #{r.id}</strong>
            <span className="status-badge" style={{ backgroundColor: getStatusColor(r.status) }}>
              {r.status}
            </span>
          </div>

          <p style={{ margin: '4px 0', fontSize: 14 }}>
            Sender: <code>{r.sender}</code>
          </p>
          <p style={{ margin: '4px 0', fontSize: 14 }}>
            Amount: <strong>${r.amount.toFixed(2)}</strong> &nbsp;|&nbsp; Fee: ${r.fee.toFixed(2)}
          </p>

          <div className="form-group" style={{ marginTop: 12 }}>
            <label style={{ fontSize: 13 }}>Proof hash (optional):</label>
            <input
              type="text"
              placeholder="0x..."
              value={proofInputs[r.id] || ''}
              onChange={(e) => setProofInputs(prev => ({ ...prev, [r.id]: e.target.value }))}
              style={{ width: '100%', marginTop: 4 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              className="btn-primary"
              disabled={!!loading[r.id]}
              onClick={() => handleConfirmPayout(r.id)}
            >
              {loading[r.id] === 'confirm' ? 'Confirming...' : 'Confirm Payout'}
            </button>
            <button
              className="btn-secondary"
              disabled={!!loading[r.id]}
              onClick={() => handleMarkFailed(r.id)}
              style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 16px', cursor: 'pointer' }}
            >
              {loading[r.id] === 'fail' ? 'Marking...' : 'Mark Failed'}
            </button>
          </div>

          {results[r.id] && (
            <div className="success" style={{ marginTop: 8 }}>
              {results[r.id].type === 'confirm'
                ? `✓ Payout confirmed — tx: ${results[r.id].txHash}`
                : `✓ Marked as failed — tx: ${results[r.id].txHash}`}
            </div>
          )}

          {errors[r.id] && (
            <div className="error" style={{ marginTop: 8 }}>{errors[r.id]}</div>
          )}
        </div>
      ))}
    </div>
  )
}
