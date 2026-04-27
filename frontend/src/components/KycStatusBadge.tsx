import React, { useEffect, useState } from 'react';
import './KycStatusBadge.css';

type KycStatus = 'pending' | 'approved' | 'rejected';
type KycLevel = 'basic' | 'intermediate' | 'advanced';

interface AnchorKycRecord {
  anchor_id: string;
  kyc_status: KycStatus;
  kyc_level?: KycLevel;
  verified_at: string;
  expires_at?: string;
  rejection_reason?: string;
}

interface UserKycStatusResponse {
  overall_status: KycStatus;
  can_transfer: boolean;
  reason?: string;
  anchors: AnchorKycRecord[];
  last_checked: string;
}

const TERMINAL_STATUSES: KycStatus[] = ['approved', 'rejected'];

interface KycStatusBadgeProps {
  userId: string;
  apiUrl?: string;
  showDetails?: boolean;
  pollingIntervalMs?: number;
}

export const KycStatusBadge: React.FC<KycStatusBadgeProps> = ({
  userId,
  apiUrl = 'http://localhost:3000',
  showDetails = true,
  pollingIntervalMs = 30_000,
}) => {
  const [status, setStatus] = useState<UserKycStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetchKycStatus();
  }, [apiUrl, userId]);

  // Auto-poll while status is pending
  useEffect(() => {
    if (!status || TERMINAL_STATUSES.includes(status.overall_status) || pollingIntervalMs <= 0) return;

    const id = setInterval(async () => {
      setPolling(true);
      await fetchKycStatus();
      setPolling(false);
    }, pollingIntervalMs);

    return () => clearInterval(id);
  }, [status?.overall_status, pollingIntervalMs]);

  const fetchKycStatus = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${apiUrl}/api/kyc/status`, {
        headers: {
          'x-user-id': userId,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch KYC status: ${response.status}`);
      }

      const data = (await response.json()) as UserKycStatusResponse;
      setStatus(data);
    } catch (err) {
      console.error('KYC status fetch error', err);
      setError('Failed to load KYC status');
    } finally {
      setLoading(false);
    }
  };

  const badgeClass = status ? `kyc-badge-${status.overall_status}` : 'kyc-badge-pending';
  const badgeText = status ? status.overall_status.toUpperCase() : 'PENDING';
  const badgeIcon = status?.overall_status === 'approved' ? '✓' : status?.overall_status === 'rejected' ? '✕' : '⏳';

  const handleClick = () => {
    if (showDetails && status) {
      setShowModal(true);
    }
  };

  if (loading) {
    return <div className="kyc-status-badge kyc-badge-loading">Loading KYC...</div>;
  }

  if (error || !status) {
    return <div className="kyc-status-badge kyc-badge-error">{error || 'Unknown KYC error'}</div>;
  }

  return (
    <>
      <div
        className={`kyc-status-badge ${badgeClass}`}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-label={`KYC status ${status.overall_status}`}
      >
        <span className="kyc-badge-icon">{badgeIcon}</span>
        <span className="kyc-badge-text">{badgeText}</span>
        {polling && <span className="kyc-badge-checking" aria-live="polite">Checking...</span>}
      </div>

      {showModal && (
        <div className="kyc-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="kyc-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="kyc-modal-header">
              <h2>KYC Status Details</h2>
              <button className="kyc-modal-close" onClick={() => setShowModal(false)}>
                ×
              </button>
            </div>

            <div className="kyc-modal-body">
              <div className="kyc-detail-row">
                <span className="kyc-detail-label">Overall Status:</span>
                <span className={`kyc-detail-value status-${status.overall_status}`}>
                  {status.overall_status.toUpperCase()}
                </span>
              </div>
              <div className="kyc-detail-row">
                <span className="kyc-detail-label">Transfer Allowed:</span>
                <span className="kyc-detail-value">{status.can_transfer ? 'Yes' : 'No'}</span>
              </div>
              <div className="kyc-detail-row">
                <span className="kyc-detail-label">Last Checked:</span>
                <span className="kyc-detail-value">
                  {new Date(status.last_checked).toLocaleString()}
                </span>
              </div>

              {!status.can_transfer && status.reason && (
                <div className="kyc-detail-row kyc-reason-row">
                  <span className="kyc-detail-label">Reason:</span>
                  <span className="kyc-detail-value">{status.reason}</span>
                </div>
              )}

              <h3 className="kyc-anchor-heading">Anchor Breakdown</h3>
              {status.anchors.length === 0 ? (
                <p className="kyc-empty-anchors">No anchor KYC records found.</p>
              ) : (
                <div className="kyc-anchor-list">
                  {status.anchors.map((anchor) => (
                    <div key={`${anchor.anchor_id}-${anchor.verified_at}`} className="kyc-anchor-card">
                      <div className="kyc-detail-row">
                        <span className="kyc-detail-label">Anchor:</span>
                        <span className="kyc-detail-value">{anchor.anchor_id}</span>
                      </div>
                      <div className="kyc-detail-row">
                        <span className="kyc-detail-label">Status:</span>
                        <span className={`kyc-detail-value status-${anchor.kyc_status}`}>
                          {anchor.kyc_status}
                        </span>
                      </div>
                      <div className="kyc-detail-row">
                        <span className="kyc-detail-label">KYC Level:</span>
                        <span className="kyc-detail-value">{anchor.kyc_level || 'N/A'}</span>
                      </div>
                      <div className="kyc-detail-row">
                        <span className="kyc-detail-label">Verified At:</span>
                        <span className="kyc-detail-value">
                          {new Date(anchor.verified_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="kyc-detail-row">
                        <span className="kyc-detail-label">Expires At:</span>
                        <span className="kyc-detail-value">
                          {anchor.expires_at ? new Date(anchor.expires_at).toLocaleString() : 'No expiry'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
