import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FeePreview } from '../FeePreview';
import * as feeService from '../../services/feePreviewService';

vi.mock('../../services/feePreviewService');

describe('FeePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('should show empty state when no amount', () => {
    render(<FeePreview amount={0} corridor="" />);
    expect(screen.getByText(/Enter amount and corridor/i)).toBeInTheDocument();
  });

  it('should show loading spinner during calculation', async () => {
    vi.mocked(feeService.getFeePreview).mockImplementation(() => new Promise(() => {}));

    render(<FeePreview amount={100} corridor="NG-USD" />);

    vi.advanceTimersByTime(500);
    expect(screen.getByText(/Calculating fees/i)).toBeInTheDocument();
  });

  it('should display fee breakdown', async () => {
    const mockFee = {
      platformFeeBps: 250,
      platformFeeAmount: 2.5,
      protocolFeeAmount: 0.5,
      netAmount: 97,
    };
    vi.mocked(feeService.getFeePreview).mockResolvedValue(mockFee);

    render(<FeePreview amount={100} corridor="NG-USD" />);

    vi.advanceTimersByTime(500);
    await waitFor(() => {
      expect(screen.getByText(/\$2.50/)).toBeInTheDocument();
      expect(screen.getByText(/\$0.50/)).toBeInTheDocument();
      expect(screen.getByText(/\$97.00/)).toBeInTheDocument();
    });
  });

  it('should show error message on API failure', async () => {
    vi.mocked(feeService.getFeePreview).mockRejectedValue(new Error('API Error'));

    render(<FeePreview amount={100} corridor="NG-USD" />);

    vi.advanceTimersByTime(500);
    await waitFor(() => {
      expect(screen.getByText(/Could not calculate fees/i)).toBeInTheDocument();
    });
  });
});
