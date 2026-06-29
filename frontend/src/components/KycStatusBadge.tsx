import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './KycStatusBadge.css';

type KycStatus = 'pending' | 'approved' | 'rejected' | 'expired';
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
  anchorKycPortalUrl?: string;
}

interface KycGuidance {
  status: KycStatus;
  title: string;
  description: string;
  requiredDocuments: string[];
  nextSteps: string[];
  estimatedReviewTime: string;
  actionUrl?: string;
  actionLabel?: string;
}

const KYC_GUIDANCE_MAP: Record<KycStatus, KycGuidance> = {
  pending: {
    status: 'pending',
    title: 'KYC Verification In Progress',
    description: 'Your identity verification is being reviewed by our compliance team.',
    requiredDocuments: ['Government-issued ID', 'Address Proof (utility bill or bank statement)'],
    nextSteps: [
      'Your submitted documents are under review',
      'We will notify you via email when verification is complete',
      'Typically takes 1-3 business days',
    ],
    estimatedReviewTime: '1-3 business days',
  },
  approved: {
    status: 'approved',
    title: 'KYC Verified',
    description: 'Your identity has been successfully verified. You can now use all platform features.',
    requiredDocuments: [],
    nextSteps: [
      'You have full access to send and receive remittances',
      'Enjoy unlimited transaction features',
    ],
    estimatedReviewTime: 'N/A',
  },
  rejected: {
    status: 'rejected',
    title: 'KYC Verification Failed',
    description: 'Your KYC verification was not approved. Please review the requirements and resubmit.',
    requiredDocuments: ['Valid Government ID', 'Proof of Address', 'Clear photos (front and back)'],
    nextSteps: [
      'Review the rejection reason below',
      'Ensure all documents are clear and readable',
      'Contact support for specific guidance on requirements',
      'Resubmit your KYC verification',
    ],
    estimatedReviewTime: '1-3 business days',
    actionLabel: 'Resubmit KYC',
  },
  expired: {
    status: 'expired',
    title: 'KYC Verification Expired',
    description: 'Your KYC verification has expired. Please renew it to continue using the platform.',
    requiredDocuments: ['Updated Government ID', 'Current Address Proof'],
    nextSteps: [
      'Your KYC verification is no longer valid',
      'Complete the renewal process to restore access',
      'Renewal usually takes 1-3 business days',
    ],
    estimatedReviewTime: '1-3 business days',
    actionLabel: 'Renew KYC',
  },
};

export const KycStatusBadge: React.FC<KycStatusBadgeProps> = ({
  userId,
  apiUrl = 'http://localhost:3000',
  showDetails = true,
  pollingIntervalMs = 30_000,
  anchorKycPortalUrl = 'https://anchor.example.com/kyc',
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UserKycStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showGuidanceModal, setShowGuidanceModal] = useState(false);

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
  const badgeText = status
    ? status.overall_status === 'expired'
      ? t('kyc.badgeExpired')
      : status.overall_status.toUpperCase()
    : 'PENDING';
  const badgeIcon =
    status?.overall_status === 'approved' ? '✓' :
    status?.overall_status === 'rejected' ? '✕' :
    status?.overall_status === 'expired' ? '⚠' : '⏳';

  const handleClick = () => {
    if (showDetails && status) {
      setShowModal(true);
    }
  };

  const handleShowGuidance = () => {
    setShowGuidanceModal(true);
  };

  if (loading) {
    return <div className="kyc-status-badge kyc-badge-loading">{t('kyc.loading')}</div>;
  }

  if (error || !status) {
    return <div className="kyc-status-badge kyc-badge-error">{error || t('kyc.errors.unknown')}</div>;
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
        {polling && <span className="kyc-badge-checking" aria-live="polite">{t('kyc.checking')}</span>}
      </div>

      {showModal && (
        <div className="kyc-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="kyc-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="kyc-modal-header">
              <h2>{t('kyc.statusDetails')}</h2>
              <button className="kyc-modal-close" onClick={() => setShowModal(false)}>
                ×
              </button>
            </div>

            <div className="kyc-modal-body">
              <div className="kyc-detail-row">
                <span className="kyc-detail-label">{t('kyc.overallStatus')}</span>
                <span className={`kyc-detail-value status-${status.overall_status}`}>
                  {status.overall_status.toUpperCase()}
                </span>
              </div>
              <div className="kyc-detail-row">
                <span className="kyc-detail-label">{t('kyc.transferAllowed')}</span>
                <span className="kyc-detail-value">{status.can_transfer ? t('kyc.transferAllowedYes') : t('kyc.transferAllowedNo')}</span>
              </div>
              <div className="kyc-detail-row">
                <span className="kyc-detail-label">{t('kyc.lastChecked')}</span>
                <span className="kyc-detail-value">
                  {new Date(status.last_checked).toLocaleString()}
                </span>
              </div>

              {!status.can_transfer && status.reason && (
                <div className="kyc-detail-row kyc-reason-row">
                  <span className="kyc-detail-label">{t('kyc.reason')}</span>
                  <span className="kyc-detail-value">{status.reason}</span>
                </div>
              )}

              {['pending', 'rejected', 'expired'].includes(status.overall_status) && (
                <button
                  onClick={handleShowGuidance}
                  style={{
                    marginTop: '16px',
                    padding: '10px 16px',
                    background: '#1976d2',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.95em',
                  }}
                >
                  View What's Next
                </button>
              )}

              <h3 className="kyc-anchor-heading">{t('kyc.anchorBreakdown')}</h3>
              {status.anchors.length === 0 ? (
                <p className="kyc-empty-anchors">{t('kyc.noAnchors')}</p>
              ) : (
                <div className="kyc-anchor-list">
                  {status.anchors.map((anchor) => (
                    <div key={`${anchor.anchor_id}-${anchor.verified_at}`} className="kyc-anchor-card">
                      <div className="kyc-detail-row">
                        <span className="kyc-detail-label">{t('kyc.anchor')}</span>
                        <span className="kyc-detail-value">{anchor.anchor_id}</span>
                      </div>
                      <div className="kyc-detail-row">
                        <span className="kyc-detail-label">{t('kyc.status')}</span>
                        <span className={`kyc-detail-value status-${anchor.kyc_status}`}>
                          {anchor.kyc_status}
                        </span>
                      </div>
                      <div className="kyc-detail-row">
                        <span className="kyc-detail-label">{t('kyc.kycLevel')}</span>
                        <span className="kyc-detail-value">{anchor.kyc_level || 'N/A'}</span>
                      </div>
                      <div className="kyc-detail-row">
                        <span className="kyc-detail-label">{t('kyc.verifiedAt')}</span>
                        <span className="kyc-detail-value">
                          {new Date(anchor.verified_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="kyc-detail-row">
                        <span className="kyc-detail-label">{t('kyc.expiresAt')}</span>
                        <span className="kyc-detail-value">
                          {anchor.expires_at ? new Date(anchor.expires_at).toLocaleString() : t('kyc.noExpiry')}
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

      {showGuidanceModal && status && (
        <div className="kyc-modal-overlay" onClick={() => setShowGuidanceModal(false)}>
          <div className="kyc-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="kyc-modal-header">
              <h2>KYC Status Guidance</h2>
              <button className="kyc-modal-close" onClick={() => setShowGuidanceModal(false)}>
                ×
              </button>
            </div>

            <div className="kyc-modal-body">
              {(() => {
                const guidance = KYC_GUIDANCE_MAP[status.overall_status];
                return (
                  <>
                    <h3 style={{ marginTop: 0, color: '#1976d2' }}>{guidance.title}</h3>
                    <p style={{ lineHeight: 1.6, color: '#555' }}>{guidance.description}</p>

                    {guidance.requiredDocuments.length > 0 && (
                      <>
                        <h4 style={{ marginTop: '16px', marginBottom: '8px' }}>Required Documents:</h4>
                        <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.8 }}>
                          {guidance.requiredDocuments.map((doc, idx) => (
                            <li key={idx}>{doc}</li>
                          ))}
                        </ul>
                      </>
                    )}

                    <h4 style={{ marginTop: '16px', marginBottom: '8px' }}>Next Steps:</h4>
                    <ol style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.8 }}>
                      {guidance.nextSteps.map((step, idx) => (
                        <li key={idx}>{step}</li>
                      ))}
                    </ol>

                    <div style={{ marginTop: '16px', padding: '12px', background: '#f5f5f5', borderRadius: '4px' }}>
                      <strong>Estimated Review Time:</strong> {guidance.estimatedReviewTime}
                    </div>

                    {(status.overall_status === 'pending' || status.overall_status === 'rejected' || status.overall_status === 'expired') && (
                      <a
                        href={anchorKycPortalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-block',
                          marginTop: '16px',
                          padding: '10px 20px',
                          background: '#4caf50',
                          color: '#fff',
                          textDecoration: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        {guidance.actionLabel || 'Go to KYC Portal'} →
                      </a>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
