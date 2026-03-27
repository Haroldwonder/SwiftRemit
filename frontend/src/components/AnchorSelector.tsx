import React, { useState, useEffect } from 'react';
import './AnchorSelector.css';

export interface AnchorProvider {
  id: string;
  name: string;
  domain: string;
  logo_url?: string;
  description: string;
  status: 'active' | 'inactive' | 'maintenance';
  fees: {
    deposit_fee_percent: number;
    deposit_fee_fixed?: number;
    withdrawal_fee_percent: number;
    withdrawal_fee_fixed?: number;
    min_fee?: number;
    max_fee?: number;
  };
  limits: {
    min_amount: number;
    max_amount: number;
    daily_limit?: number;
    monthly_limit?: number;
  };
  compliance: {
    kyc_required: boolean;
    kyc_level: 'basic' | 'intermediate' | 'advanced';
    supported_countries: string[];
    restricted_countries: string[];
    documents_required: string[];
  };
  supported_currencies: string[];
  processing_time: string;
  rating?: number;
  total_transactions?: number;
  verified: boolean;
}

interface AnchorSelectorProps {
  onSelect: (anchor: AnchorProvider) => void;
  selectedAnchorId?: string;
  currency?: string;
  apiUrl?: string;
}

export const AnchorSelector: React.FC<AnchorSelectorProps> = ({
  onSelect,
  selectedAnchorId,
  currency,
  apiUrl = 'http://localhost:3000',
}) => {
  const [anchors, setAnchors] = useState<AnchorProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedAnchor, setSelectedAnchor] = useState<AnchorProvider | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetchAnchors();
  }, [currency]);

  useEffect(() => {
    if (selectedAnchorId && anchors.length > 0) {
      const anchor = anchors.find(a => a.id === selectedAnchorId);
      if (anchor) setSelectedAnchor(anchor);
    }
  }, [selectedAnchorId, anchors]);

  const fetchAnchors = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (currency) params.append('currency', currency);
      params.append('status', 'active');
      const response = await fetch(`${apiUrl}/api/anchors?${params}`);
      const data = await response.json();
      if (data.success) {
        setAnchors(data.data);
      } else {
        setError(data.error?.message || 'Failed to load anchors');
      }
    } catch (err) {
      setError('Failed to connect to anchor service');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (anchor: AnchorProvider) => {
    setSelectedAnchor(anchor);
    setIsOpen(false);
    onSelect(anchor);
  };

  const formatFee = (percent: number, fixed?: number) => 
    fixed && fixed > 0 ? `${percent}% + $${fixed.toFixed(2)}` : `${percent}%`;

  const formatAmount = (amount: number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  const getKycLevelBadge = (level: string) => {
    const badges = {
      basic: { text: 'Basic KYC', class: 'kyc-basic' },
      intermediate: { text: 'Standard KYC', class: 'kyc-intermediate' },
      advanced: { text: 'Enhanced KYC', class: 'kyc-advanced' },
    };
    return badges[level as keyof typeof badges] || badges.basic;
  };

  if (loading) return <div className="anchor-selector loading">Loading anchor providers...</div>;
  if (error) return (
    <div className="anchor-selector error">
      <span className="error-icon">⚠️</span>
      <span>{error}</span>
      <button onClick={fetchAnchors} className="retry-button">Retry</button>
    </div>
  );

  return (
    <div className="anchor-selector">
      <label className="anchor-label">Select Anchor Provider</label>
      <div className="anchor-dropdown">
        <button className={`anchor-dropdown-trigger ${isOpen ? 'open' : ''}`} onClick={() => setIsOpen(!isOpen)}>
          {selectedAnchor ? (
            <div className="selected-anchor">
              {selectedAnchor.logo_url && <img src={selectedAnchor.logo_url} alt="" className="anchor-logo" />}
              <div className="anchor-info">
                <span className="anchor-name">{selectedAnchor.name}</span>
                {selectedAnchor.verified && <span className="verified-badge">✓</span>}
              </div>
            </div>
          ) : <span className="placeholder">Choose an anchor provider...</span>}
          <span className="dropdown-arrow">{isOpen ? '▲' : '▼'}</span>
        </button>
        {isOpen && (
          <div className="anchor-dropdown-menu">
            {anchors.map((anchor) => (
              <div key={anchor.id} className={`anchor-option ${selectedAnchor?.id === anchor.id ? 'selected' : ''}`} onClick={() => handleSelect(anchor)}>
                <div className="anchor-option-header">
                  {anchor.logo_url && <img src={anchor.logo_url} alt="" className="anchor-logo" />}
                  <div className="anchor-option-info">
                    <div className="anchor-option-name">{anchor.name}{anchor.verified && <span className="verified-badge">✓</span>}</div>
                    <div className="anchor-option-domain">{anchor.domain}</div>
                  </div>
                  {anchor.rating && <div className="anchor-rating">⭐ {anchor.rating.toFixed(1)}</div>}
                </div>
                <div className="anchor-option-details">
                  <div className="detail-row"><span className="detail-label">Fees:</span><span className="detail-value">{formatFee(anchor.fees.withdrawal_fee_percent, anchor.fees.withdrawal_fee_fixed)}</span></div>
                  <div className="detail-row"><span className="detail-label">Limits:</span><span className="detail-value">{formatAmount(anchor.limits.min_amount)} - {formatAmount(anchor.limits.max_amount)}</span></div>
                  <div className="detail-row"><span className="detail-label">Processing:</span><span className="detail-value">{anchor.processing_time}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {selectedAnchor && (
        <div className="anchor-details-section">
          <button className="show-details-button" onClick={() => setShowDetails(!showDetails)}>{showDetails ? '▼' : '▶'} {showDetails ? 'Hide' : 'Show'} Details</button>
          {showDetails && (
            <div className="anchor-details-panel">
              <div className="details-section">
                <h4>Fee Structure</h4>
                <div className="details-grid">
                  <div className="detail-item"><span className="detail-label">Deposit Fee:</span><span className="detail-value">{formatFee(selectedAnchor.fees.deposit_fee_percent, selectedAnchor.fees.deposit_fee_fixed)}</span></div>
                  <div className="detail-item"><span className="detail-label">Withdrawal Fee:</span><span className="detail-value">{formatFee(selectedAnchor.fees.withdrawal_fee_percent, selectedAnchor.fees.withdrawal_fee_fixed)}</span></div>
                  {selectedAnchor.fees.min_fee && <div className="detail-item"><span className="detail-label">Minimum Fee:</span><span className="detail-value">{formatAmount(selectedAnchor.fees.min_fee)}</span></div>}
                  {selectedAnchor.fees.max_fee && <div className="detail-item"><span className="detail-label">Maximum Fee:</span><span className="detail-value">{formatAmount(selectedAnchor.fees.max_fee)}</span></div>}
                </div>
              </div>
              <div className="details-section">
                <h4>Transaction Limits</h4>
                <div className="details-grid">
                  <div className="detail-item"><span className="detail-label">Per Transaction:</span><span className="detail-value">{formatAmount(selectedAnchor.limits.min_amount)} - {formatAmount(selectedAnchor.limits.max_amount)}</span></div>
                  {selectedAnchor.limits.daily_limit && <div className="detail-item"><span className="detail-label">Daily Limit:</span><span className="detail-value">{formatAmount(selectedAnchor.limits.daily_limit)}</span></div>}
                  {selectedAnchor.limits.monthly_limit && <div className="detail-item"><span className="detail-label">Monthly Limit:</span><span className="detail-value">{formatAmount(selectedAnchor.limits.monthly_limit)}</span></div>}
                </div>
              </div>
              <div className="details-section">
                <h4>Compliance Requirements</h4>
                <div className="compliance-info">
                  <div className="detail-item"><span className="detail-label">KYC Level:</span><span className={`kyc-badge ${getKycLevelBadge(selectedAnchor.compliance.kyc_level).class}`}>{getKycLevelBadge(selectedAnchor.compliance.kyc_level).text}</span></div>
                  <div className="detail-item"><span className="detail-label">Required Documents:</span><ul className="documents-list">{selectedAnchor.compliance.documents_required.map((doc, idx) => <li key={idx}>{doc.replace(/_/g, ' ')}</li>)}</ul></div>
                  <div className="detail-item"><span className="detail-label">Supported Countries:</span><span className="detail-value">{selectedAnchor.compliance.supported_countries.join(', ')}</span></div>
                  {selectedAnchor.compliance.restricted_countries.length > 0 && <div className="detail-item warning"><span className="detail-label">⚠️ Restricted Countries:</span><span className="detail-value">{selectedAnchor.compliance.restricted_countries.join(', ')}</span></div>}
                </div>
              </div>
              <div className="details-section">
                <h4>Additional Information</h4>
                <div className="details-grid">
                  <div className="detail-item"><span className="detail-label">Supported Currencies:</span><span className="detail-value">{selectedAnchor.supported_currencies.join(', ')}</span></div>
                  {selectedAnchor.total_transactions && <div className="detail-item"><span className="detail-label">Total Transactions:</span><span className="detail-value">{selectedAnchor.total_transactions.toLocaleString()}</span></div>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
