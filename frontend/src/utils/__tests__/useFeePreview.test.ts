import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFeePreview } from '../useFeePreview';
import * as feeService from '../../services/feePreviewService';

vi.mock('../../services/feePreviewService');

describe('useFeePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('should fetch fee preview after debounce', async () => {
    const mockFee = {
      platformFeeBps: 250,
      platformFeeAmount: 2.5,
      protocolFeeAmount: 0.5,
      netAmount: 97,
    };
    vi.mocked(feeService.getFeePreview).mockResolvedValue(mockFee);

    const { result } = renderHook(() => useFeePreview(100, 'NG-USD', { debounceMs: 500 }));

    expect(result.current.loading).toBe(true);

    vi.advanceTimersByTime(500);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.feeData).toEqual(mockFee);
    expect(result.current.error).toBeNull();
  });

  it('should handle errors gracefully', async () => {
    const error = new Error('API Error');
    vi.mocked(feeService.getFeePreview).mockRejectedValue(error);
    const onError = vi.fn();

    const { result } = renderHook(() => useFeePreview(100, 'NG-USD', { onError }));

    vi.advanceTimersByTime(500);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toEqual(error);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('should clear data when amount is zero', () => {
    const { result } = renderHook(() => useFeePreview(0, 'NG-USD'));

    expect(result.current.feeData).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
