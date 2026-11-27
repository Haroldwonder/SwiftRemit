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
