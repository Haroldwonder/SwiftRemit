import React, { useRef, useEffect, useState, useCallback } from 'react';
import './ProofOfPayout.css';
import { horizonService, type SettlementCompletedEvent } from '../services/horizonService';

interface ProofOfPayoutProps {
  remittanceId: number;
  onRelease?: (remittanceId: number, proofImage: string) => Promise<void>;
}

type ProofValidationStatus = 'pending' | 'valid' | 'invalid';

/** Convert an arbitrary string to a hex representation of its UTF-8 bytes */
function toHex(value: string): string {
  return Array.from(new TextEncoder().encode(value))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Derive a deterministic "proof hash" from the on-chain event fields */
function deriveProofHash(event: SettlementCompletedEvent): string {
  const raw = [
    event.remittanceId,
    event.sender,
    event.agent,
    event.amount,
    event.fee,
    event.transactionHash,
  ].join(':');
  return toHex(raw);
}

export const ProofOfPayout: React.FC<ProofOfPayoutProps> = ({ remittanceId, onRelease }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isReleasing, setIsReleasing] = useState(false);
  const [eventData, setEventData] = useState<SettlementCompletedEvent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [validationStatus, setValidationStatus] = useState<ProofValidationStatus>('pending');

  useEffect(() => {
    const fetchEventData = async () => {
      setIsLoading(true);
      setError(null);
      setValidationStatus('pending');

      try {
        const data = await horizonService.fetchCompletedEvent(remittanceId);

        if (data) {
          setEventData(data);
          // Validate: transaction hash must be non-empty and 64 hex chars
          const isValid = /^[0-9a-fA-F]{64}$/.test(data.transactionHash);
          setValidationStatus(isValid ? 'valid' : 'invalid');
        } else {
          setError('No completed event found for this remittance ID');
          setValidationStatus('invalid');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch event data');
        setValidationStatus('invalid');
      } finally {
        setIsLoading(false);
      }
    };

    fetchEventData();
  }, [remittanceId]);

  useEffect(() => {
    const startCamera = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error('Error accessing camera:', err);
      }
    };

    if (onRelease) {
      startCamera();
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [onRelease]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        setCapturedImage(canvas.toDataURL('image/png'));
      }
    }
  };

  const handleRelease = async () => {
    if (capturedImage && onRelease) {
      setIsReleasing(true);
      try {
        await onRelease(remittanceId, capturedImage);
      } catch (err) {
        console.error('Error releasing funds:', err);
      } finally {
        setIsReleasing(false);
      }
    }
  };

  const formatAmount = (amount: string): string => {
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    return (num / 10000000).toFixed(7);
  };

  const formatTimestamp = (timestamp: string): string =>
    new Date(timestamp).toLocaleString();

  const truncateAddress = (address: string): string =>
    address.length <= 12 ? address : `${address.slice(0, 6)}...${address.slice(-6)}`;

  const validationLabel: Record<ProofValidationStatus, string> = {
    pending: '⏳ Validating proof…',
    valid: '✅ Proof valid',
    invalid: '❌ Proof invalid',
  };

  return (
    <div className="proof-of-payout">
      <h2>Proof of Payout</h2>

      {isLoading && (
        <div className="loading-state">
          <p>Loading payout details...</p>
        </div>
      )}

      {error && (
        <div className="error-state">
          <p className="error-message">{error}</p>
        </div>
      )}

      {!isLoading && !error && eventData && (
        <div className="payout-details">
          {/* Validation status banner */}
          <div
            className={`proof-validation-status proof-validation-${validationStatus}`}
            role="status"
            aria-live="polite"
          >
            {validationLabel[validationStatus]}
          </div>

          <div className="detail-section">
            <h3>Transaction Details</h3>
            <div className="detail-row">
              <span className="detail-label">Remittance ID:</span>
              <span className="detail-value">{eventData.remittanceId}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Sender:</span>
              <span className="detail-value" title={eventData.sender}>
                {truncateAddress(eventData.sender)}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Agent:</span>
              <span className="detail-value" title={eventData.agent}>
                {truncateAddress(eventData.agent)}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Amount:</span>
              <span className="detail-value">{formatAmount(eventData.amount)} USDC</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Fee:</span>
              <span className="detail-value">{formatAmount(eventData.fee)} USDC</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Timestamp:</span>
              <span className="detail-value">{formatTimestamp(eventData.timestamp)}</span>
            </div>

            {/* Proof hash — hex display with copy button */}
            <div className="detail-row proof-hash-row">
              <span className="detail-label">
                Proof Hash
                <span
                  className="proof-hash-tooltip"
                  title="A hex-encoded commitment derived from the on-chain settlement event fields. Use it to independently verify this payout on Stellar Expert."
                  aria-label="What is the proof hash?"
                >
                  {' '}ℹ️
                </span>
                :
              </span>
              <span className="detail-value proof-hash-value">
                <code className="proof-hash-hex" aria-label="Proof hash hex string">
                  {deriveProofHash(eventData)}
                </code>
                <button
                  type="button"
                  className="copy-button"
                  onClick={() => copyToClipboard(deriveProofHash(eventData))}
                  aria-label="Copy proof hash to clipboard"
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </span>
            </div>

            {/* Transaction hash with copy */}
            <div className="detail-row proof-hash-row">
              <span className="detail-label">Transaction Hash:</span>
              <span className="detail-value proof-hash-value">
                <code className="proof-hash-hex" title={eventData.transactionHash}>
                  {truncateAddress(eventData.transactionHash)}
                </code>
                <button
                  type="button"
                  className="copy-button"
                  onClick={() => copyToClipboard(eventData.transactionHash)}
                  aria-label="Copy transaction hash to clipboard"
                >
                  Copy
                </button>
              </span>
            </div>
          </div>

          <div className="action-section">
            <a
              href={horizonService.getStellarExpertLink(eventData.transactionHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="stellar-expert-link"
            >
              Verify on Stellar Expert →
            </a>
          </div>
        </div>
      )}

      {onRelease && (
        <>
          <p>Capture an image as proof that the payout has been made to the recipient.</p>
          {!capturedImage ? (
            <div className="camera-container">
              <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
              <div className="camera-overlay">
                <div className="overlay-frame"></div>
                <p className="overlay-text">Position the proof document within the frame</p>
              </div>
              <button onClick={captureImage} className="capture-button">Capture</button>
            </div>
          ) : (
            <div className="preview-container">
              <img src={capturedImage} alt="Captured proof" className="captured-image" />
              <div className="preview-actions">
                <button onClick={() => setCapturedImage(null)} className="retake-button">Retake</button>
                <button onClick={handleRelease} disabled={isReleasing} className="release-button">
                  {isReleasing ? 'Releasing...' : 'Release Funds'}
                </button>
              </div>
            </div>
          )}
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </>
      )}
    </div>
  );
};
