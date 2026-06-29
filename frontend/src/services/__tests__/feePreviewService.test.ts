import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFeePreview } from '../feePreviewService';

describe('feePreviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch fee preview successfully', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          platformFeeBps: 250,
          platformFeeAmount: 2.5,
          protocolFeeAmount: 0.5,
          netAmount: 97,
        }),
      })
    ) as any;

    const result = await getFeePreview(100, 'NG-USD');
    expect(result.platformFeeBps).toBe(250);
    expect(result.platformFeeAmount).toBe(2.5);
    expect(result.netAmount).toBe(97);
  });

  it('should throw error for invalid amount', async () => {
    await expect(getFeePreview(0, 'NG-USD')).rejects.toThrow('Amount must be positive');
    await expect(getFeePreview(-10, 'NG-USD')).rejects.toThrow('Amount must be positive');
  });

  it('should throw error on API failure', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        statusText: 'Bad Request',
      })
    ) as any;

    await expect(getFeePreview(100, 'NG-USD')).rejects.toThrow('Fee preview failed');
  });
});
