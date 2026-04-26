import React, { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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

    FreighterService.connect()
      .then((result) => {
        if (result.publicKey === stored) {
          setPublicKey(result.publicKey);
          setNetwork(result.network ?? defaultNetwork);
          setConnected(true);
          if (FreighterService.isNetworkMismatch(result.network ?? defaultNetwork, defaultNetwork)) {
            setNetworkWarning(
              t('wallet.warnings.networkMismatch', {
                walletNetwork: result.network ?? defaultNetwork,
                expectedNetwork: defaultNetwork,
              })
            );
          }
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      })
      .catch(() => {
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

      localStorage.setItem(STORAGE_KEY, result.publicKey);

      if (FreighterService.isNetworkMismatch(connectedNetwork, defaultNetwork)) {
        setNetworkWarning(
          t('wallet.warnings.networkMismatch', {
            walletNetwork: connectedNetwork,
            expectedNetwork: defaultNetwork,
          })
        );
      }
    } catch (connectError) {
      setConnected(false);
      const errorMessage = connectError instanceof Error ? connectError.message : 'Unknown error';

      if (errorMessage.includes('not installed')) {
        setError(t('wallet.errors.notInstalled'));
      } else if (errorMessage.includes('not connected')) {
        setError(t('wallet.errors.notConnected'));
      } else {
        setError(t('wallet.errors.connectFailed'));
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

      localStorage.removeItem(STORAGE_KEY);
      setConnected(false);
      setPublicKey('');
    } catch (disconnectError) {
      setError(t('wallet.errors.disconnectFailed'));
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
        setError(t('wallet.errors.signatureRejected'));
      } else {
        setError(t('wallet.errors.signatureFailed'));
      }
      console.error(signatureError);
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <section className="wallet-card" aria-label={t('wallet.title')}>
      <div className="wallet-row">
        <h2 className="wallet-title">{t('wallet.title')}</h2>
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
            <p className="wallet-meta">{t('wallet.connectedKey')}</p>
          </>
        ) : (
          <>
            <p className="wallet-key">{t('wallet.notConnected')}</p>
            <p className="wallet-meta">{t('wallet.connectPrompt')}</p>
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
              {isConnecting ? t('wallet.connecting') : t('wallet.connect')}
            </button>
            {!isFreighterInstalled && (
              <a
                href={FreighterService.getInstallUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="wallet-install-link"
              >
                {t('wallet.installLink')}
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
              {isSigning ? t('wallet.signing') : t('wallet.signMessage')}
            </button>
            <button
              type="button"
              className="wallet-button danger"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? t('wallet.disconnecting') : t('wallet.disconnect')}
            </button>
          </>
        )}
      </div>

      {error && <p className="wallet-error">{error}</p>}
      {networkWarning && <p className="wallet-warning">{networkWarning}</p>}
    </section>
  );
};
