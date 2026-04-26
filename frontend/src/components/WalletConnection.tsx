import React, { useMemo, useState, useEffect } from 'react';
import './WalletConnection.css';
import { FreighterService } from '../utils/freighter';
import type { NetworkType } from '../utils/freighter';

export type { NetworkType };

const STORAGE_KEY = 'swiftremit_wallet_address';

interface WalletConnectionResult {
  publicKey: string;
  network?: NetworkType;
}

interface WalletConnectionProps {
  defaultNetwork?: NetworkType;
  onConnect?: () => Promise<WalletConnectionResult>;
  onDisconnect?: () => Promise<void> | void;
  onRequestSignature?: () => Promise<void>;
}

function truncatePublicKey(publicKey: string): string {
  if (publicKey.length <= 16) return publicKey;
  return `${publicKey.slice(0, 6)}...${publicKey.slice(-6)}`;
}

function isRejectedSignature(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const message = 'message' in error ? String(error.message).toLowerCase() : '';
  const code = 'code' in error ? String(error.code) : '';

  return (
    code === '4001' ||
    message.includes('rejected') ||
    message.includes('denied') ||
    message.includes('declined')
  );
}

export const WalletConnection: React.FC<WalletConnectionProps> = ({
  defaultNetwork = 'Testnet',
  onConnect,
  onDisconnect,
  onRequestSignature,
}) => {
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState('');
  const [network, setNetwork] = useState<NetworkType>(defaultNetwork);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [networkWarning, setNetworkWarning] = useState<string | null>(null);

  const isFreighterInstalled = FreighterService.isInstalled();

  const publicKeyText = useMemo(() => truncatePublicKey(publicKey), [publicKey]);

  // Restore session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    // Verify the stored address is still authorized in Freighter
    FreighterService.connect()
      .then((result) => {
        if (result.publicKey === stored) {
          setPublicKey(result.publicKey);
          setNetwork(result.network ?? defaultNetwork);
          setConnected(true);
          if (FreighterService.isNetworkMismatch(result.network ?? defaultNetwork, defaultNetwork)) {
            setNetworkWarning(
              `Warning: Wallet is connected to ${result.network ?? defaultNetwork}, but ${defaultNetwork} is expected.`
            );
          }
        } else {
          // Stored address no longer matches — clear stale entry
          localStorage.removeItem(STORAGE_KEY);
        }
      })
      .catch(() => {
        // Freighter not available or not connected — clear stale entry
        localStorage.removeItem(STORAGE_KEY);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async () => {
    setError(null);
    setNetworkWarning(null);
    setIsConnecting(true);

    try {
      const result = onConnect
        ? await onConnect()
        : await FreighterService.connect();

      setPublicKey(result.publicKey);
      const connectedNetwork = result.network ?? defaultNetwork;
      setNetwork(connectedNetwork);
      setConnected(true);

      // Persist to localStorage
      localStorage.setItem(STORAGE_KEY, result.publicKey);

      // Check for network mismatch
      if (FreighterService.isNetworkMismatch(connectedNetwork, defaultNetwork)) {
        setNetworkWarning(
          `Warning: Wallet is connected to ${connectedNetwork}, but ${defaultNetwork} is expected.`
        );
      }
    } catch (connectError) {
      setConnected(false);
      const errorMessage = connectError instanceof Error ? connectError.message : 'Unknown error';
      
      if (errorMessage.includes('not installed')) {
        setError('Freighter wallet is not installed.');
      } else if (errorMessage.includes('not connected')) {
        setError('Please unlock your Freighter wallet and try again.');
      } else {
        setError('Failed to connect wallet. Please try again.');
      }
      console.error(connectError);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setError(null);
    setNetworkWarning(null);
    setIsDisconnecting(true);

    try {
      if (onDisconnect) {
        await onDisconnect();
      }

      // Clear persisted session
      localStorage.removeItem(STORAGE_KEY);

      setConnected(false);
      setPublicKey('');
    } catch (disconnectError) {
      setError('Failed to disconnect wallet.');
      console.error(disconnectError);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSignature = async () => {
    setError(null);
    setIsSigning(true);

    try {
      if (onRequestSignature) {
        await onRequestSignature();
      }
    } catch (signatureError) {
      if (isRejectedSignature(signatureError)) {
        setError('Signature request was rejected.');
      } else {
        setError('Unable to complete signature request.');
      }
      console.error(signatureError);
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <section className="wallet-card" aria-label="Wallet connection">
      <div className="wallet-row">
        <h2 className="wallet-title">Wallet</h2>
        <span
          className={`network-pill ${network === 'Mainnet' ? 'mainnet' : 'testnet'}`}
          aria-label={`Network: ${network}`}
        >
          {network}
        </span>
      </div>

      <div className="wallet-state" role="status">
        {connected ? (
          <>
            <p className="wallet-key">{publicKeyText}</p>
            <p className="wallet-meta">Connected public key</p>
          </>
        ) : (
          <>
            <p className="wallet-key">Not connected</p>
            <p className="wallet-meta">Connect a wallet to continue</p>
          </>
        )}
      </div>

      <div className="wallet-actions">
        {!connected ? (
          <>
            <button
              type="button"
              className="wallet-button primary"
              onClick={handleConnect}
              disabled={isConnecting || !isFreighterInstalled}
            >
              {isConnecting ? 'Connecting...' : 'Connect'}
            </button>
            {!isFreighterInstalled && (
              <a
                href={FreighterService.getInstallUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="wallet-install-link"
              >
                Install Freighter Wallet
              </a>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="wallet-button secondary"
              onClick={handleSignature}
              disabled={isSigning}
            >
              {isSigning ? 'Waiting for signature...' : 'Sign Message'}
            </button>
            <button
              type="button"
              className="wallet-button danger"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </>
        )}
      </div>

      {error && <p className="wallet-error">{error}</p>}
      {networkWarning && <p className="wallet-warning">{networkWarning}</p>}
    </section>
  );
};
