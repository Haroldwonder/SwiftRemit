import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  /** @deprecated Use currencies instead */
  currency?: string;
  currencies?: string[];
  apiUrl?: string;
}

export const AnchorSelector: React.FC<AnchorSelectorProps> = ({
  onSelect,
  selectedAnchorId,
  currency,
  currencies,
  apiUrl = 'http://localhost:3000',
}) => {
  // Normalise to array; single `currency` prop is backward-compatible
  const activeCurrencies = currencies ?? (currency ? [currency] : []);
  const [anchors, setAnchors] = useState<AnchorProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedAnchor, setSelectedAnchor] = useState<AnchorProvider | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useRef(`anchor-listbox-${Math.random().toString(36).substr(2, 9)}`).current;

  useEffect(() => {
    fetchAnchors();
  }, [activeCurrencies.join(',')]);  // eslint-disable-line react-hooks/exhaustive-deps

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
      // Send each currency as a separate `currencies[]` param; fall back to
      // legacy `currency` for servers that haven't been updated yet.
      if (activeCurrencies.length === 1) {
        params.append('currency', activeCurrencies[0]);
      } else if (activeCurrencies.length > 1) {
        activeCurrencies.forEach(c => params.append('currencies[]', c));
      }
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
    setFocusedIndex(-1);
    onSelect(anchor);
    // Return focus to trigger button
    setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const handleToggle = () => {
    if (!isOpen) {
      setIsOpen(true);
      // Set focus to selected item or first item when opening
      const selectedIndex = selectedAnchor 
        ? anchors.findIndex(a => a.id === selectedAnchor.id)
        : 0;
      setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    } else {
      setIsOpen(false);
      setFocusedIndex(-1);
    }
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) {
      // When closed, open on Enter, Space, or Arrow keys
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIsOpen(true);
        const selectedIndex = selectedAnchor 
          ? anchors.findIndex(a => a.id === selectedAnchor.id)
          : 0;
        setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
      }
      return;
    }

    // When open, handle navigation
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => (prev < anchors.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => (prev > 0 ? prev - 1 : prev));
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIndex(anchors.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < anchors.length) {
          handleSelect(anchors[focusedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setFocusedIndex(-1);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        // Close on tab and allow default behavior
        setIsOpen(false);
        setFocusedIndex(-1);
        break;
    }
  }, [isOpen, focusedIndex, anchors, selectedAnchor]);

  // Scroll focused option into view
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && menuRef.current) {
      const focusedElement = menuRef.current.querySelector(`[data-index="${focusedIndex}"]`);
      if (focusedElement && typeof focusedElement.scrollIntoView === 'function') {
        focusedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [focusedIndex, isOpen]);

  // Close dropdown when clicking/tapping outside (pointerdown covers mouse + touch)
  useEffect(() => {
    const handleOutsidePointer = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    };

    if (isOpen) {
      document.addEventListener('pointerdown', handleOutsidePointer);
      return () => document.removeEventListener('pointerdown', handleOutsidePointer);
    }
  }, [isOpen]);

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
      <label className="anchor-label" id={`${listboxId}-label`}>Select Anchor Provider</label>
      <div className="anchor-dropdown">
        <button 
          ref={triggerRef}
          className={`anchor-dropdown-trigger ${isOpen ? 'open' : ''}`} 
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-labelledby={`${listboxId}-label`}
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={isOpen && focusedIndex >= 0 ? `${listboxId}-option-${focusedIndex}` : undefined}
        >
          {selectedAnchor ? (
            <div className="selected-anchor">
              {selectedAnchor.logo_url && <img src={selectedAnchor.logo_url} alt="" className="anchor-logo" />}
              <div className="anchor-info">
                <span className="anchor-name">{selectedAnchor.name}</span>
                {selectedAnchor.verified && <span className="verified-badge" aria-label="Verified">✓</span>}
              </div>
            </div>
          ) : <span className="placeholder">Choose an anchor provider...</span>}
          <span className="dropdown-arrow" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
        </button>
        {isOpen && (
          <div 
            ref={menuRef}
            className="anchor-dropdown-menu"
            role="listbox"
            id={listboxId}
            aria-labelledby={`${listboxId}-label`}
            tabIndex={-1}
          >
            {anchors.map((anchor, index) => (
              <div 
                key={anchor.id} 
                className={`anchor-option ${selectedAnchor?.id === anchor.id ? 'selected' : ''} ${focusedIndex === index ? 'focused' : ''}`}
                onClick={() => handleSelect(anchor)}
                role="option"
                id={`${listboxId}-option-${index}`}
                aria-selected={selectedAnchor?.id === anchor.id}
                data-index={index}
              >
                <div className="anchor-option-header">
                  {anchor.logo_url && <img src={anchor.logo_url} alt="" className="anchor-logo" />}
                  <div className="anchor-option-info">
                    <div className="anchor-option-name">
                      {anchor.name}
                      {anchor.verified && <span className="verified-badge" aria-label="Verified">✓</span>}
                    </div>
                    <div className="anchor-option-domain">{anchor.domain}</div>
                  </div>
                  {anchor.rating && <div className="anchor-rating" aria-label={`Rating: ${anchor.rating.toFixed(1)} stars`}>⭐ {anchor.rating.toFixed(1)}</div>}
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
          <button 
            className="show-details-button" 
            onClick={() => setShowDetails(!showDetails)}
            aria-expanded={showDetails}
            aria-controls="anchor-details-panel"
          >
            <span aria-hidden="true">{showDetails ? '▼' : '▶'}</span> {showDetails ? 'Hide' : 'Show'} Details
          </button>
          {showDetails && (
            <div className="anchor-details-panel" id="anchor-details-panel">
              <div className="details-section">
                <h4>Fee Structure</h4>
                <div className="details-grid">
                  <div className="detail-item"><span className="detail-label">Deposit Fee:</span><span className="detail-value">{formatFee(selectedAnchor.fees.deposit_fee_percent, selectedAnchor.fees.deposit_fee_fixed)}</span></div>
                  <div className="detail-item"><span className="detail-label">Withdrawal Fee:</span><span className="detail-value">{formatFee(selectedAnchor.fees.withdrawal_fee_percent, selectedAnchor.fees.withdrawal_fee_fixed)}</span></div>
                  {selectedAnchor.fees.min_fee && <div className="detail-item"><span className="detail-label">Minimum Fee:</span><span className="detail-value">{formatAmount(selectedAnchor.fees.min_fee)}</span></div>}
                  {selectedAnchor.fees.max_fee && <div className="detail-item"><span className="detail-label">Maximum Fee:</span><span className="detail-value">{formatAmount(selectedAnchor.fees.max_fee)}</span></div>}
                </div>
                {activeCurrencies.length > 0 && (
                  <div className="per-currency-fees" aria-label="Per-currency fee breakdown">
                    <h5>Per-Currency Breakdown</h5>
                    {activeCurrencies.map(cur => {
                      const supported = selectedAnchor.supported_currencies.includes(cur.toUpperCase());
                      return (
                        <div key={cur} className={`currency-fee-row ${supported ? '' : 'unsupported'}`}>
                          <span className="currency-code">{cur.toUpperCase()}</span>
                          {supported ? (
                            <>
                              <span className="detail-label">Deposit:</span>
                              <span className="detail-value">{formatFee(selectedAnchor.fees.deposit_fee_percent, selectedAnchor.fees.deposit_fee_fixed)}</span>
                              <span className="detail-label">Withdrawal:</span>
                              <span className="detail-value">{formatFee(selectedAnchor.fees.withdrawal_fee_percent, selectedAnchor.fees.withdrawal_fee_fixed)}</span>
                            </>
                          ) : (
                            <span className="unsupported-label" aria-label={`${cur} not supported`}>⚠️ Not supported</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
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
