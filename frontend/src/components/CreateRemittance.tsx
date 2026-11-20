import { FC, useState, FormEvent } from 'react'
import { signTransaction } from '@stellar/freighter-api'
import { Networks, TransactionBuilder } from '@stellar/stellar-sdk'
import { SwiftRemitClient, SwiftRemitError } from '../../../sdk/src/index.js'

const RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK === 'mainnet'
  ? Networks.PUBLIC
  : Networks.TESTNET

const STROOPS_PER_UNIT = 10_000_000n
const DECIMALS = 7

/** Convert a decimal amount string to stroops without floating point rounding. */
export function amountToStroops(amount: string): bigint {
  if (typeof amount !== 'string') throw new Error('Amount must be a string')
  const trimmed = amount.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Amount must be a non-negative decimal number')
  }
  const [intPart, fracPart = ''] = trimmed.split('.')
  if (fracPart.length > DECIMALS) {
    throw new Error(`Amount cannot have more than ${DECIMALS} decimal places`)
  }
  const stroops = BigInt(intPart) * STROOPS_PER_UNIT + BigInt(fracPart.padEnd(DECIMALS, '0'))
  if (stroops === 0n) {
    throw new Error('Amount must be greater than 0')
  }
  return stroops
}

interface CreateRemittanceProps {
  walletAddress: string
  contractId: string
  whitelistedTokens?: string[]
}

interface RemittanceResult {
  message: string
  id: string
  txHash: string
  amount: string
  amountInStroops: string
  agent: string
  token: string
  memo: string | null
}

/** Map an SDK/contract error to a user-facing message via the SDK error map. */
export function describeCreateError(err: unknown): string {
  if (err instanceof SwiftRemitError) {
    return err.remediation ? `${err.message} — ${err.remediation}` : err.message
  }
  if (err instanceof Error && err.message) return err.message
  return 'Failed to create remittance'
}

const CreateRemittance: FC<CreateRemittanceProps> = ({ walletAddress, contractId, whitelistedTokens = [] }) => {
  const [agentAddress, setAgentAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [selectedToken, setSelectedToken] = useState(whitelistedTokens[0] || '')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RemittanceResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      if (!contractId) {
        throw new Error('Please enter a contract ID')
      }

      if (!walletAddress) {
        throw new Error('Please connect your wallet')
      }

      if (!selectedToken) {
        throw new Error('Please select a token')
      }

      const amountInStroops = amountToStroops(amount)

      const client = new SwiftRemitClient({
        contractId,
        networkPassphrase: NETWORK_PASSPHRASE,
        rpcUrl: RPC_URL,
      })

      // Build create_remittance through the SDK, sign with the connected wallet,
      // then submit and wait for confirmation.
      const tx = await client.createRemittance({
        sender: walletAddress,
        agent: agentAddress,
        amount: amountInStroops,
        token: selectedToken,
      })

      const { signedTxXdr, error: signError } = await signTransaction(tx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: walletAddress,
      })
      if (signError) {
        throw new Error(signError.message || 'Wallet signing failed')
      }

      const signedTx = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE)
      const submitted = await client.submitSignedTransaction(signedTx)

      // The contract returns the new remittance ID; fall back to the latest
      // remittance for this sender when the result carries no return value.
      let remittanceId: bigint | null = null
      const returnValue = submitted.returnValue
      if (returnValue) {
        try {
          const native = returnValue.value()
          remittanceId = typeof native === 'bigint' ? native : BigInt(native as number)
        } catch {
          remittanceId = null
        }
      }
      if (remittanceId === null) {
        const ids = await client.getRemittancesBySender(walletAddress, walletAddress, 0n, 1n)
        remittanceId = ids.length > 0 ? ids[ids.length - 1] : null
      }

      setResult({
        message: 'Remittance created successfully!',
        id: remittanceId !== null ? remittanceId.toString() : 'pending',
        txHash: submitted.hash,
        amount: amount,
        amountInStroops: amountInStroops.toString(),
        agent: agentAddress,
        token: selectedToken,
        memo: memo || null,
      })

      // Reset form
      setAgentAddress('')
      setAmount('')
      setMemo('')
    } catch (err) {
      setError(describeCreateError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="panel">
      <h2>Create Remittance</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Token:</label>
          <select
            value={selectedToken}
            onChange={(e) => setSelectedToken(e.target.value)}
            required
          >
            <option value="">Select a token...</option>
            {whitelistedTokens.map((token) => (
              <option key={token} value={token}>
                {token}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Agent Address:</label>
          <input
            type="text"
            value={agentAddress}
            onChange={(e) => setAgentAddress(e.target.value)}
            placeholder="GXXXXXXX..."
            required
          />
        </div>

        <div className="form-group">
          <label>Amount ({selectedToken || 'Token'}):</label>
          <input
            type="number"
            step="0.0000001"
            min="0.0000001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="100.00"
            required
          />
        </div>

        <div className="form-group">
          <label>
            Memo <span style={{ fontWeight: 'normal', color: '#888' }}>(optional)</span>:
          </label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value.slice(0, 100))}
            placeholder="e.g. Invoice #1234"
            maxLength={100}
          />
          <small style={{ color: '#888' }}>{memo.length}/100</small>
        </div>

        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Creating...' : 'Create Remittance'}
        </button>
      </form>

      {result && (
        <div className="success">
          <p>{result.message}</p>
          <p>Remittance ID: {result.id}</p>
          <p>Transaction: {result.txHash}</p>
          <p>Token: {result.token}</p>
          {result.memo && <p>Memo: {result.memo}</p>}
        </div>
      )}

      {error && <div className="error">{error}</div>}
    </div>
  )
}

export default CreateRemittance
