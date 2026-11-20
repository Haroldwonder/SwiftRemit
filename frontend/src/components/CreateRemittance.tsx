import { FC, useState, useEffect, FormEvent } from 'react'
import { Address, Contract, Horizon, rpc as SorobanRpc, TransactionBuilder, Networks, scValToNative } from '@stellar/stellar-sdk'

const STROOPS_PER_UNIT = 10_000_000n
const DECIMALS = 7

const RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org'
const HORIZON_URL = import.meta.env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org'
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK === 'mainnet'
  ? Networks.PUBLIC
  : Networks.TESTNET

export interface TokenMetadata {
  /** Asset code / symbol, e.g. `USDC`. */
  symbol?: string
  /** Issuer home domain, e.g. `centre.io`. */
  issuerDomain?: string
}

const metadataCache = new Map<string, TokenMetadata>()

/** Shorten a Stellar address/contract ID for display, e.g. `CABC…WXYZ`. */
export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 1) return address
  return `${address.slice(0, chars)}…${address.slice(-chars)}`
}

/** Human-readable label for a token: `USDC (centre.io)`, `USDC`, or a shortened address. */
export function formatTokenLabel(token: string, metadata?: TokenMetadata): string {
  if (!metadata?.symbol) return shortenAddress(token)
  return metadata.issuerDomain ? `${metadata.symbol} (${metadata.issuerDomain})` : metadata.symbol
}

async function fetchIssuerDomain(issuer: string): Promise<string | undefined> {
  try {
    const server = new Horizon.Server(HORIZON_URL)
    const account = await server.loadAccount(issuer)
    return account.home_domain || undefined
  } catch {
    return undefined
  }
}

async function resolveTokenMetadata(token: string): Promise<TokenMetadata> {
  const cached = metadataCache.get(token)
  if (cached) return cached

  const metadata: TokenMetadata = {}
  try {
    const server = new SorobanRpc.Server(RPC_URL)
    const contract = new Contract(token)
    const source = await server.getAccount(Address.fromScAddress(contract.address()).toString())
    const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(contract.call('symbol'))
      .setTimeout(30)
      .build()
    const simulated = await server.simulateTransaction(tx)
    if (!SorobanRpc.Api.isSimulationError(simulated) && simulated.result) {
      const symbol = scValToNative(simulated.result.retval)
      if (typeof symbol === 'string' && symbol) metadata.symbol = symbol
    }
  } catch {
    // Fall back to a shortened address when metadata cannot be resolved.
  }

  if (metadata.symbol) {
    const issuer = await fetchIssuerDomain(token)
    if (issuer) metadata.issuerDomain = issuer
  }

  metadataCache.set(token, metadata)
  return metadata
}

/**
 * Maximum size of a Stellar `MEMO_TEXT` memo, in UTF-8 bytes.
 * The memo is stored in the contract's `Option<String>` field and forwarded to
 * the Stellar transaction as a text memo, so it must fit in 28 bytes.
 */
export const MEMO_MAX_BYTES = 28

/** Number of UTF-8 bytes a string occupies (not the number of characters). */
export function memoByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/** Truncate a string so its UTF-8 encoding fits within `maxBytes`, never splitting a code point. */
export function truncateToBytes(value: string, maxBytes: number = MEMO_MAX_BYTES): string {
  if (memoByteLength(value) <= maxBytes) return value
  let result = ''
  let used = 0
  for (const char of value) {
    const size = memoByteLength(char)
    if (used + size > maxBytes) break
    result += char
    used += size
  }
  return result
}

/** Validation message for a memo that exceeds the Stellar text memo limit. */
export function memoValidationError(value: string): string | null {
  const bytes = memoByteLength(value)
  if (bytes <= MEMO_MAX_BYTES) return null
  return `Memo must be at most ${MEMO_MAX_BYTES} bytes (UTF-8); currently ${bytes} bytes.`
}

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
  return BigInt(intPart) * STROOPS_PER_UNIT + BigInt(fracPart.padEnd(DECIMALS, '0'))
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
  const [tokenMetadata, setTokenMetadata] = useState<Record<string, TokenMetadata>>({})

  useEffect(() => {
    let cancelled = false
    Promise.all(
      whitelistedTokens.map(async (token) => [token, await resolveTokenMetadata(token)] as const)
    ).then((entries) => {
      if (!cancelled) setTokenMetadata(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [whitelistedTokens.join(',')])

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

      const memoError = memoValidationError(memo)
      if (memoError) {
        throw new Error(memoError)
      }
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
              <option key={token} value={token} title={token}>
                {formatTokenLabel(token, tokenMetadata[token])}
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
            Memo <span className="label-hint">(optional)</span>:
          </label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(truncateToBytes(e.target.value))}
            placeholder="e.g. Invoice #1234"
            aria-describedby="memo-hint"
            aria-invalid={memoValidationError(memo) ? true : undefined}
          />
          <small id="memo-hint" className="field-hint">
            {memoByteLength(memo)}/{MEMO_MAX_BYTES} bytes
          </small>
          {memoValidationError(memo) && (
            <small className="field-error" role="alert">
              {memoValidationError(memo)}
            </small>
          )}
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
