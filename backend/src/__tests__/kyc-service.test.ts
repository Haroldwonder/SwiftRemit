import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KycService } from '../kyc-service';

// Mock the database functions
vi.mock('../database', () => ({
  getAnchorKycConfigs: vi.fn(),
  getUsersNeedingKycCheck: vi.fn(),
  saveUserKycStatus: vi.fn(),
  getUserKycStatus: vi.fn(),
  getApprovedUsers: vi.fn(),
}));

// Mock the stellar functions
vi.mock('../stellar', () => ({
  updateKycStatusOnChain: vi.fn(),
}));

// Mock axios
vi.mock('axios');
import axios from 'axios';

describe('KycService', () => {
  let kycService: KycService;

  beforeEach(() => {
    kycService = new KycService();
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should load anchor configurations', async () => {
      const mockConfigs = [
        {
          anchor_id: 'anchor-1',
          kyc_server_url: 'https://kyc.anchor1.com',
          auth_token: 'token1',
          polling_interval_minutes: 60,
          enabled: true,
        },
      ];

      const { getAnchorKycConfigs } = await import('../database');
      (getAnchorKycConfigs as any).mockResolvedValue(mockConfigs);

      await kycService.initialize();

      expect(getAnchorKycConfigs).toHaveBeenCalled();
    });
  });

  describe('pollAllAnchors', () => {
    it('should poll KYC status for all configured anchors', async () => {
      const mockConfigs = [
        {
          anchor_id: 'anchor-1',
          kyc_server_url: 'https://kyc.anchor1.com',
          auth_token: 'token1',
          polling_interval_minutes: 60,
          enabled: true,
        },
      ];

      const { getAnchorKycConfigs, getUsersNeedingKycCheck } = await import('../database');
      (getAnchorKycConfigs as any).mockResolvedValue(mockConfigs);
      (getUsersNeedingKycCheck as any).mockResolvedValue([]);

      await kycService.initialize();
      await kycService.pollAllAnchors();

      expect(getUsersNeedingKycCheck).toHaveBeenCalledWith('anchor-1', 60);
    });
  });

  describe('queryAnchorKycStatus', () => {
    it('should return KYC status from anchor API', async () => {
      const mockResponse = {
        data: {
          id: 'user123',
          status: 'approved',
          expires_at: '2024-12-31T23:59:59Z',
        },
      };

      (axios.get as any).mockResolvedValue(mockResponse);

      const config = {
        anchor_id: 'anchor-1',
        kyc_server_url: 'https://kyc.anchor1.com',
        auth_token: 'token1',
        polling_interval_minutes: 60,
        enabled: true,
      };

      // Access private method for testing
      const result = await (kycService as any).queryAnchorKycStatus(config, 'user123');

      expect(axios.get).toHaveBeenCalledWith(
        'https://kyc.anchor1.com/customer/user123',
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer token1',
            'Content-Type': 'application/json',
          },
        })
      );
      expect(result).toEqual(mockResponse.data);
    });

    it('should return null when user not found', async () => {
      const error = {
        response: { status: 404 },
      };
      (axios.get as any).mockRejectedValue(error);

      const config = {
        anchor_id: 'anchor-1',
        kyc_server_url: 'https://kyc.anchor1.com',
        auth_token: 'token1',
        polling_interval_minutes: 60,
        enabled: true,
      };

      const result = await (kycService as any).queryAnchorKycStatus(config, 'user123');

      expect(result).toBeNull();
    });
  });

  describe('mapSep12StatusToInternal', () => {
    it('should map SEP-12 statuses correctly', () => {
      expect((kycService as any).mapSep12StatusToInternal('approved')).toBe('approved');
      expect((kycService as any).mapSep12StatusToInternal('rejected')).toBe('rejected');
      expect((kycService as any).mapSep12StatusToInternal('pending')).toBe('pending');
      expect((kycService as any).mapSep12StatusToInternal('unknown')).toBe('pending');
    });
  });

  describe('isUserKycApproved', () => {
    it('should return true if user has approved KYC', async () => {
      const { getApprovedUsers } = await import('../database');
      (getApprovedUsers as any).mockResolvedValue([
        {
          user_id: 'user123',
          anchor_id: 'anchor-1',
          status: 'approved',
          last_checked: new Date(),
        },
      ]);

      const result = await kycService.isUserKycApproved('user123');

      expect(result).toBe(true);
      expect(getApprovedUsers).toHaveBeenCalled();
    });

    it('should return false if user has no approved KYC', async () => {
      const { getApprovedUsers } = await import('../database');
      (getApprovedUsers as any).mockResolvedValue([]);

      const result = await kycService.isUserKycApproved('user123');

      expect(result).toBe(false);
    });
  });
});