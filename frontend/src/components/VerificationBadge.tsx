import React, { useState, useEffect } from 'react';
import './VerificationBadge.css';

export enum VerificationStatus {
  Verified = 'verified',
  Unverified = 'unverified',
  Suspicious = 'suspicious',
}

export interface AssetVerification {
  asset_code: string;
  issuer: string;
  status: VerificationStatus;
  reputation_score: number;
  last_verified: string;
  trustline_count: number;
  has_toml: boolean;
  stellar_expert_verified?: boolean;
  community_reports?: number;
}

interface VerificationBadgeProps {
  assetCode: string;
  issuer: string;
  apiUrl?: string;
  onWarning?: (verification: AssetVerification) => void;
  showDetails?: boolean;
}

export const VerificationBadge: React.FC<VerificationBadgeProps> = ({
  assetCode,
  issuer,
  apiUrl = 'http://localhost:3000',
  onWarning,
  showDetails = true,
}) => {
  const [verification, setVerification] = useState<AssetVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);

  useEffect(() => {
    fetchVerification();
  }, [assetCode, issuer]);

  const fetchVerification = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${apiUrl}/api/verification/${assetCode}/${issuer}`
      );

      if (response.status === 404) {
        setVerification(null);
        setError('Asset not verified');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch verification');
      }

      const data = await response.json();
      setVerification(data);

      // Trigger warning callback for suspicious/unverified assets
      if (
        (data.status === VerificationStatus.Suspicious ||
          data.status === VerificationStatus.Unverified) &&
        onWarning
      ) {
        onWarning(data);
      }

      // Auto-show warning modal for suspicious assets
      if (data.status === VerificationStatus.Suspicious) {
        setShowWarningModal(true);
      }
    } catch (err) {
      setError('Failed to load verification');
      console.error('Verification fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getBadgeClass = () => {
    if (!verification) return 'badge-unverified';
    switch (verification.status) {
      case VerificationStatus.Verified:
        return 'badge-verified';
      case VerificationStatus.Suspicious:
        return 'badge-suspicious';
      default:
        return 'badge-unverified';
    }
  };

  const getBadgeIcon = () => {
    if (!verification) return '?';
    switch (verification.status) {
      case VerificationStatus.Verified:
        return '✓';
      case VerificationStatus.Suspicious:
        return '⚠';
      default:
        return '?';
    }
  };

  const getBadgeText = () => {
    if (!verification) return 'Unverified';
    switch (verification.status) {
      case VerificationStatus.Verified:
        return 'Verified';
      case VerificationStatus.Suspicious:
        return 'Suspicious';
      default:
        return 'Unverified';
    }
  };

  const handleBadgeClick = () => {
    if (showDetails && verification) {
      setShowModal(true);
    }
  };

  const handleReportSuspicious = async () => {
    try {
      const reason = prompt('Please describe why you think this asset is suspicious:');
      if (!reason) return;

      const response = await fetch(`${apiUrl}/api/verification/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assetCode,
          issuer,
          reason,
        }),
      });

      if (response.ok) {
        alert('Report submitted successfully. Thank you for helping keep the community safe!');
        fetchVerification(); // Refresh data
      } else {
        alert('Failed to submit report. Please try again.');
      }
    } catch (err) {
      console.error('Report error:', err);
      alert('Failed to submit report. Please try again.');
    }
  };

  if (loading) {
    return <div className="verification-badge badge-loading">Loading...</div>;
  }

  if (error && !verification) {
    return (
      <div className="verification-badge badge-unverified" onClick={handleBadgeClick}>
        <span className="badge-icon">?</span>
        <span className="badge-text">Unverified</span>
      </div>
    );
  }

  return (
    <>
      <div
        className={`verification-badge ${getBadgeClass()}`}
        onClick={handleBadgeClick}
        role="button"
        tabIndex={0}
        aria-label={`Asset verification status: ${getBadgeText()}`}
      >
        <span className="badge-icon">{getBadgeIcon()}</span>
        <span className="badge-text">{getBadgeText()}</span>
        {verification && (
          <span className="badge-score">{verification.reputation_score}/100</span>
        )}
      </div>

      {/* Details Modal */}
      {showModal && verification && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Asset Verification Details</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="detail-row">
                <span className="detail-label">Asset Code:</span>
                <span className="detail-value">{verification.asset_code}</span>
              </div>

              <div className="detail-row">
                <span className="detail-label">Issuer:</span>
                <span className="detail-value detail-issuer">{verification.issuer}</span>
              </div>

              <div className="detail-row">
                <span className="detail-label">Status:</span>
                <span className={`detail-value status-${verification.status}`}>
                  {verification.status.toUpperCase()}
                </span>
              </div>

              <div className="detail-row">
                <span className="detail-label">Reputation Score:</span>
                <span className="detail-value">
                  {verification.reputation_score}/100
                </span>
              </div>

              <div className="detail-row">
                <span className="detail-label">Trustlines:</span>
                <span className="detail-value">
                  {verification.trustline_count.toLocaleString()}
                </span>
              </div>

              <div className="detail-row">
                <span className="detail-label">Stellar TOML:</span>
                <span className="detail-value">
                  {verification.has_toml ? '✓ Found' : '✗ Not Found'}
                </span>
              </div>

              {verification.stellar_expert_verified !== undefined && (
                <div className="detail-row">
                  <span className="detail-label">Stellar Expert:</span>
                  <span className="detail-value">
                    {verification.stellar_expert_verified ? '✓ Verified' : '✗ Not Verified'}
                  </span>
                </div>
              )}

              <div className="detail-row">
                <span className="detail-label">Last Verified:</span>
                <span className="detail-value">
                  {new Date(verification.last_verified).toLocaleString()}
                </span>
              </div>

              {verification.community_reports !== undefined &&
                verification.community_reports > 0 && (
                  <div className="detail-row warning">
                    <span className="detail-label">Community Reports:</span>
                    <span className="detail-value">{verification.community_reports}</span>
                  </div>
                )}
            </div>

            <div className="modal-footer">
              <button className="btn-report" onClick={handleReportSuspicious}>
                Report as Suspicious
              </button>
              <button className="btn-close" onClick={() => setShowModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warning Modal for Suspicious Assets */}
      {showWarningModal && verification?.status === VerificationStatus.Suspicious && (
        <div className="modal-overlay warning-modal">
          <div className="modal-content warning-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header warning-header">
              <h2>⚠ Asset Warning</h2>
            </div>

            <div className="modal-body">
              <p className="warning-text">
                This asset has been flagged as <strong>suspicious</strong> based on our
                verification checks. Please exercise caution when interacting with this asset.
              </p>

              <div className="warning-details">
                <p><strong>Asset:</strong> {verification.asset_code}</p>
                <p><strong>Reputation Score:</strong> {verification.reputation_score}/100</p>
                {verification.community_reports && verification.community_reports > 0 && (
                  <p><strong>Community Reports:</strong> {verification.community_reports}</p>
                )}
              </div>

              <p className="warning-advice">
                We recommend verifying the asset issuer independently before proceeding.
              </p>
            </div>

            <div className="modal-footer">
              <button
                className="btn-primary"
                onClick={() => {
                  setShowWarningModal(false);
                  setShowModal(true);
                }}
              >
                View Details
              </button>
              <button className="btn-secondary" onClick={() => setShowWarningModal(false)}>
                I Understand
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default VerificationBadge;
