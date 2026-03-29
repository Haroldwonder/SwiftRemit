/**
 * AnchorSelectorExample
 *
 * Minimal working example of AnchorSelector with mock data.
 * Suitable for Storybook stories or standalone rendering — no live API needed.
 *
 * Strategy:
 *   - On mount, patches window.fetch to intercept /api/anchors calls
 *   - Returns mock anchor data matching the AnchorProvider shape
 *   - Supports the `currency` query param for filtering
 *   - Restores original fetch on unmount
 */
import React, { useState, useEffect } from 'react';
import { AnchorSelector, AnchorProvider } from '../components/AnchorSelector';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------
const MOCK_ANCHORS: AnchorProvider[] = [
  {
    id: 'anchor-1',
    name: 'MoneyGram Access',
    domain: 'moneygram.stellar.org',
    logo_url: 'https://placehold.co/32x32?text=MG',
    description: 'Global money transfer service with extensive agent network',
    status: 'active',
    fees: {
      deposit_fee_percent: 1.5,
      deposit_fee_fixed: 0,
      withdrawal_fee_percent: 2.0,
      withdrawal_fee_fixed: 1.0,
      min_fee: 1.0,
      max_fee: 50.0,
    },
    limits: { min_amount: 10, max_amount: 10000, daily_limit: 25000, monthly_limit: 100000 },
    compliance: {
      kyc_required: true,
      kyc_level: 'intermediate',
      supported_countries: ['US', 'CA', 'MX', 'GB', 'PH', 'IN'],
      restricted_countries: ['KP', 'IR', 'SY'],
      documents_required: ['government_id', 'proof_of_address'],
    },
    supported_currencies: ['USD', 'EUR', 'GBP', 'PHP', 'INR'],
    processing_time: '1-3 business days',
    rating: 4.5,
    total_transactions: 125000,
    verified: true,
  },
  {
    id: 'anchor-2',
    name: 'Circle USDC',
    domain: 'circle.com',
    logo_url: 'https://placehold.co/32x32?text=CC',
    description: 'Leading USDC issuer with instant settlement',
    status: 'active',
    fees: {
      deposit_fee_percent: 0.5,
      withdrawal_fee_percent: 0.5,
      min_fee: 0,
      max_fee: 25.0,
    },
    limits: { min_amount: 1, max_amount: 50000, daily_limit: 100000, monthly_limit: 500000 },
    compliance: {
      kyc_required: true,
      kyc_level: 'advanced',
      supported_countries: ['US', 'CA', 'GB'],
      restricted_countries: ['KP', 'IR', 'SY', 'CU'],
      documents_required: ['government_id', 'proof_of_address', 'ssn_or_tax_id'],
    },
    supported_currencies: ['USD', 'EUR'],
    processing_time: 'Instant',
    rating: 4.8,
    total_transactions: 500000,
    verified: true,
  },
  {
    id: 'anchor-3',
    name: 'AnchorUSD',
    domain: 'anchorusd.com',
    logo_url: 'https://placehold.co/32x32?text=AU',
    description: 'Fast and reliable USD anchor for Stellar network',
    status: 'active',
    fees: {
      deposit_fee_percent: 1.0,
      deposit_fee_fixed: 0.5,
      withdrawal_fee_percent: 1.0,
      withdrawal_fee_fixed: 0.5,
      min_fee: 0.5,
      max_fee: 30.0,
    },
    limits: { min_amount: 5, max_amount: 25000, daily_limit: 50000 },
    compliance: {
      kyc_required: true,
      kyc_level: 'basic',
      supported_countries: ['US', 'CA', 'MX', 'BR', 'AR'],
      restricted_countries: ['KP', 'IR'],
      documents_required: ['government_id'],
    },
    supported_currencies: ['USD'],
    processing_time: '2-4 hours',
    rating: 4.2,
    total_transactions: 75000,
    verified: true,
  },
];

// ---------------------------------------------------------------------------
// Fetch interceptor
// ---------------------------------------------------------------------------
function installMockFetch(): () => void {
  const original = window.fetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : (input as Request).url;

    if (url.includes('/api/anchors')) {
      const { searchParams } = new URL(url, 'http://localhost');
      const currency = searchParams.get('currency');

      const data = currency
        ? MOCK_ANCHORS.filter((a) => a.supported_currencies.includes(currency))
        : MOCK_ANCHORS;

      return new Response(
        JSON.stringify({ success: true, data, count: data.length, timestamp: new Date().toISOString() }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return original(input, init);
  };

  return () => {
    window.fetch = original;
  };
}

// ---------------------------------------------------------------------------
// Example component
// ---------------------------------------------------------------------------
export const AnchorSelectorExample: React.FC = () => {
  const [selectedAnchor, setSelectedAnchor] = useState<AnchorProvider | null>(null);
  const [currency, setCurrency] = useState<string>('USD');

  useEffect(() => {
    const restore = installMockFetch();
    return restore;
  }, []);

  return (
    <div style={{ padding: '24px', maxWidth: '560px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h2 style={{ marginBottom: '16px' }}>AnchorSelector — Mock Example</h2>

      <div style={{ marginBottom: '20px' }}>
        <label htmlFor="currency-select" style={{ display: 'block', marginBottom: '6px', fontSize: '14px' }}>
          Filter by currency
        </label>
        <select
          id="currency-select"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #ccc', fontSize: '14px' }}
        >
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
          <option value="PHP">PHP</option>
          <option value="INR">INR</option>
        </select>
      </div>

      <AnchorSelector
        onSelect={(anchor) => {
          setSelectedAnchor(anchor);
          console.log('[AnchorSelectorExample] selected:', anchor);
        }}
        currency={currency}
        selectedAnchorId={selectedAnchor?.id}
        apiUrl="http://localhost:3000"
      />

      {selectedAnchor && (
        <pre
          style={{
            marginTop: '24px',
            padding: '16px',
            background: '#f4f4f4',
            borderRadius: '6px',
            fontSize: '12px',
            overflowX: 'auto',
          }}
        >
          {JSON.stringify(selectedAnchor, null, 2)}
        </pre>
      )}
    </div>
  );
};

export default AnchorSelectorExample;
