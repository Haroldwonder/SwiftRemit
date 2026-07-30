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
          platform_fee: 2.5,
          protocol_fee: 0.5,
          integrator_fee: 0.25,
          corridor_fee: 0.25,
          net_amount: 96.5,
        }),
      })
    ) as any;

    const result = await getFeePreview(100, 'NG-USD');
    expect(result.platformFeeBps).toBe(250);
    expect(result.platformFeeAmount).toBe(2.5);
    expect(result.integratorFeeAmount).toBe(0.25);
    expect(result.corridorFeeAmount).toBe(0.25);
    expect(result.totalFeeAmount).toBe(3.5);
    expect(result.netAmount).toBe(96.5);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/contract/get-fee-breakdown'),
      expect.objectContaining({
        body: expect.stringContaining('get_fee_breakdown'),
      }),
    );
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
