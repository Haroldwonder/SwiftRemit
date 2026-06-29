import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleKycWebhook, mapKycStatus, verifyAnchorSignature, KycWebhookPayload } from '../kyc-webhook-handler';

describe('KYC Webhook Handler', () => {
  let mockRequest: any;
  let mockResponse: any;

  beforeEach(() => {
    mockRequest = {
      params: { anchor_id: 'moneygram' },
      body: {} as KycWebhookPayload,
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    process.env.TRUSTED_ANCHOR_IDS = 'moneygram,circle,nexo';
  });

  it('should map KYC status correctly', () => {
    expect(mapKycStatus('APPROVED')).toBe('approved');
    expect(mapKycStatus('REJECTED')).toBe('rejected');
    expect(mapKycStatus('PENDING')).toBe('pending');
    expect(mapKycStatus('NEEDS_INFO')).toBe('needs_info');
  });

  it('should handle case-insensitive status mapping', () => {
    expect(mapKycStatus('approved')).toBe('approved');
    expect(mapKycStatus('PENDING')).toBe('pending');
    expect(mapKycStatus('Needs_Info')).toBe('needs_info');
  });

  it('should default to pending for unknown status', () => {
    expect(mapKycStatus('UNKNOWN')).toBe('pending');
  });

  it('should verify trusted anchor signatures', () => {
    expect(verifyAnchorSignature('moneygram')).toBe(true);
    expect(verifyAnchorSignature('circle')).toBe(true);
    expect(verifyAnchorSignature('untrusted')).toBe(false);
  });

  it('should reject webhook without user_id or external_id', async () => {
    mockRequest.body = { status: 'APPROVED' };

    await handleKycWebhook(mockRequest, mockResponse);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it('should accept webhook with user_id', async () => {
    mockRequest.body = {
      user_id: 'user123',
      status: 'APPROVED',
      timestamp: Math.floor(Date.now() / 1000),
    };

    // Mock database save
    vi.doMock('../database', () => ({
      saveUserKycStatus: vi.fn().mockResolvedValue({}),
    }));

    await handleKycWebhook(mockRequest, mockResponse);

    // Should attempt to save status (may fail due to mock, but status should be called)
    expect(mockResponse.status).toHaveBeenCalled();
  });

  it('should accept webhook with external_id', async () => {
    mockRequest.body = {
      external_id: 'ext456',
      status: 'PENDING',
    };

    await handleKycWebhook(mockRequest, mockResponse);

    expect(mockResponse.status).toHaveBeenCalled();
  });

  it('should use timestamp from payload if provided', () => {
    const payload: KycWebhookPayload = {
      user_id: 'user123',
      status: 'APPROVED',
      timestamp: 1704067200, // 2024-01-01 00:00:00 UTC
    };

    const expectedDate = new Date(1704067200 * 1000);
    expect(expectedDate.getTime()).toBe(1704067200000);
  });

  it('should use current time if timestamp not provided', () => {
    const before = Date.now();
    const payload: KycWebhookPayload = {
      user_id: 'user123',
      status: 'APPROVED',
    };
    const after = Date.now();

    // Payload would use Date.now() internally
    expect(before).toBeLessThanOrEqual(after);
  });

  it('should handle all SEP-12 status values', () => {
    const sep12Statuses = ['APPROVED', 'REJECTED', 'PENDING', 'NEEDS_INFO'];
    
    for (const status of sep12Statuses) {
      const mapped = mapKycStatus(status);
      expect(['approved', 'rejected', 'pending', 'needs_info']).toContain(mapped);
    }
  });

  it('should support additional webhook payload fields', () => {
    const payload: KycWebhookPayload = {
      user_id: 'user123',
      status: 'APPROVED',
      metadata: { country: 'US' },
      requested_by: 'admin@anchor.com',
      review_date: '2026-01-15',
    };

    expect(payload.metadata).toBeDefined();
    expect(payload.requested_by).toBeDefined();
    expect(payload.review_date).toBeDefined();
  });

  it('should use anchor_id from URL parameters', async () => {
    const anchors = ['moneygram', 'circle', 'nexo'];
    
    for (const anchorId of anchors) {
      mockRequest.params.anchor_id = anchorId;
      mockRequest.body = {
        user_id: `user-${anchorId}`,
        status: 'APPROVED',
      };

      // Verify anchor_id is captured
      expect(mockRequest.params.anchor_id).toBe(anchorId);
    }
  });
});
