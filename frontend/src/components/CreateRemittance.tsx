import { FC, useState, FormEvent } from 'react'

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
  if (stroops <= 0n) {
    throw new Error('Amount must be greater than zero')
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
  id: number
  amount: string
  amountInStroops: string
  agent: string
  token: string
  memo: string | null
}

const CreateRemittance: FC<CreateRemittanceProps> = ({ contractId, whitelistedTokens = [] }) => {
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

      if (!selectedToken) {
        throw new Error('Please select a token')
      }

      const amountInStroops = amountToStroops(amount)
      // This is a placeholder - you'll need to implement actual contract interaction
      // using Stellar SDK and the contract's WASM interface
      
      setResult({
        message: 'Remittance created successfully!',
        id: Math.floor(Math.random() * 1000), // Mock ID
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
      setError((err instanceof Error ? err.message : 'Failed to create remittance') || 'Failed to create remittance')
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
            step="0.01"
            min="0.01"
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
          <p>Token: {result.token}</p>
          {result.memo && <p>Memo: {result.memo}</p>}
        </div>
      )}

      {error && <div className="error">{error}</div>}
    </div>
  )
}

export default CreateRemittance
