import React from 'react';
import { useFeePreview } from '../utils/useFeePreview';
import type { FeeBreakdown } from '../services/feePreviewService';

interface FeePreviewProps {
  amount: number;
  corridor: string;
  onError?: (error: Error) => void;
}

function Spinner(): React.ReactElement {
  return <span className="fee-preview-spinner" aria-label="Loading fee calculation" />;
}

export function FeePreview({ amount, corridor, onError }: FeePreviewProps): React.ReactElement {
  const { feeData, loading, error } = useFeePreview(amount, corridor, { debounceMs: 500, onError });

  if (!amount || !corridor) {
    return <div className="fee-preview fee-preview-empty">Enter amount and corridor</div>;
  }

  if (loading) {
    return (
      <div className="fee-preview" role="status" aria-live="polite">
        <Spinner />
        <span>Calculating fees...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fee-preview fee-preview-error" role="alert">
        Could not calculate fees
      </div>
    );
  }

  if (!feeData) {
    return <div className="fee-preview fee-preview-empty" />;
  }

  return (
    <div className="fee-preview" role="region" aria-label="Fee breakdown">
      <div className="fee-breakdown">
        <div className="fee-item">
          <span className="fee-label">Platform Fee ({(feeData.platformFeeBps / 100).toFixed(2)}%):</span>
          <span className="fee-amount">${feeData.platformFeeAmount.toFixed(2)}</span>
        </div>
        <div className="fee-item">
          <span className="fee-label">Protocol Fee:</span>
          <span className="fee-amount">${feeData.protocolFeeAmount.toFixed(2)}</span>
        </div>
        <div className="fee-item fee-net">
          <span className="fee-label">Net Amount:</span>
          <span className="fee-amount">${feeData.netAmount.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
