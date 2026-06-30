import { useState } from 'react'
import { isConnected, getPublicKey, requestAccess } from '@stellar/freighter-api'

const ERROR_TYPES = {
  NOT_INSTALLED: 'notInstalled',
  USER_REJECTED: 'userRejected',
  NETWORK_MISMATCH: 'networkMismatch',
  GENERIC: 'generic'
}

function getErrorType(err) {
  if (!err) return ERROR_TYPES.GENERIC
  const msg = err.message?.toLowerCase() || ''
  if (msg.includes('not installed') || msg.includes('freighter')) return ERROR_TYPES.NOT_INSTALLED
  if (msg.includes('user rejected') || msg.includes('denied')) return ERROR_TYPES.USER_REJECTED
  if (msg.includes('network') || msg.includes('testnet') || msg.includes('mainnet')) return ERROR_TYPES.NETWORK_MISMATCH
  return ERROR_TYPES.GENERIC
}

export default function WalletConnect({ walletAddress, setWalletAddress }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [errorType, setErrorType] = useState(null)

  const connectWallet = async () => {
    setLoading(true)
    setError(null)
    setErrorType(null)

    try {
      const connected = await isConnected()
      
      if (!connected) {
        const err = new Error('Freighter wallet not found. Please install it.')
        setErrorType(ERROR_TYPES.NOT_INSTALLED)
        setError(err)
        setLoading(false)
        return
      }

      await requestAccess()
      const publicKey = await getPublicKey()
      setWalletAddress(publicKey)
    } catch (err) {
      const type = getErrorType(err)
      setErrorType(type)
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  const disconnectWallet = () => {
    setWalletAddress(null)
  }

  const renderErrorMessage = () => {
    if (!error) return null
    
    const baseMsg = error.message || 'Failed to connect wallet'
    
    switch (errorType) {
      case ERROR_TYPES.NOT_INSTALLED:
        return (
          <div className="error-container">
            <p className="error">{baseMsg}</p>
            <a href="https://www.freighter.app/" target="_blank" rel="noopener noreferrer" className="btn-link">
              Install Freighter Wallet
            </a>
          </div>
        )
      case ERROR_TYPES.NETWORK_MISMATCH:
        return (
          <div className="error-container">
            <p className="error">{baseMsg}</p>
            <p className="hint">Please switch your Freighter wallet to Testnet or Mainnet.</p>
          </div>
        )
      case ERROR_TYPES.USER_REJECTED:
        return (
          <div className="error-container">
            <p className="error">Connection rejected. Please try again.</p>
            <button onClick={connectWallet} className="btn-link retry-btn">
              Retry Connection
            </button>
          </div>
        )
      default:
        return (
          <div className="error-container">
            <p className="error">{baseMsg}</p>
            <button onClick={connectWallet} className="btn-link retry-btn">
              Retry
            </button>
          </div>
        )
    }
  }

  if (walletAddress) {
    return (
      <div className="wallet-connected">
        <p>Connected: {walletAddress.slice(0, 8)}...{walletAddress.slice(-8)}</p>
        <button onClick={disconnectWallet} className="btn-secondary">
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div className="wallet-connect">
      <button 
        onClick={connectWallet} 
        disabled={loading}
        className="btn-primary"
        data-testid="connect-wallet-btn"
      >
        {loading ? 'Connecting...' : 'Connect Freighter Wallet'}
      </button>
      {renderErrorMessage()}
      {!error && (
        <p className="hint">
          Don't have Freighter? <a href="https://www.freighter.app/" target="_blank" rel="noopener noreferrer">Install it here</a>
        </p>
      )}
    </div>
  )
}
