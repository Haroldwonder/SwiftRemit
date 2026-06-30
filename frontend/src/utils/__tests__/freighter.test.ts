import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FreighterService } from '../freighter';
import * as freighterApi from '@stellar/freighter-api';

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
}));

describe('FreighterService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default: Freighter is installed
    window.freighter = {
      isConnected: vi.fn(),
      getPublicKey: vi.fn(),
      getNetwork: vi.fn(),
      signTransaction: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isInstalled', () => {
    it('returns true when Freighter is installed', () => {
      expect(FreighterService.isInstalled()).toBe(true);
    });

    it('returns false when Freighter is not installed', () => {
      delete (window as any).freighter;
      
      expect(FreighterService.isInstalled()).toBe(false);
    });
  });

  describe('getInstallUrl', () => {
    it('returns the Freighter installation URL', () => {
      expect(FreighterService.getInstallUrl()).toBe('https://www.freighter.app/');
    });
  });

  describe('connect', () => {
    const mockPublicKey = 'GBZXN7PIRZGNMHGAU2LYGAZGQG4RYSQ3TB2T6O3COVGW6OLBDEQ2COFQ';

    it('successfully connects and returns public key and network', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: mockPublicKey });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });

      const result = await FreighterService.connect();

      expect(result).toEqual({
        publicKey: mockPublicKey,
        network: 'Testnet',
      });
    });

    it('throws error when Freighter is not installed', async () => {
      delete (window as any).freighter;

      await expect(FreighterService.connect()).rejects.toThrow(
        'Freighter wallet is not installed'
      );
    });

    it('throws error when Freighter is not connected', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: false });

      await expect(FreighterService.connect()).rejects.toThrow(
        'Freighter wallet is not connected'
      );
    });

    it('maps PUBLIC network to Mainnet', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: mockPublicKey });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'PUBLIC', networkPassphrase: 'Public Global Stellar Network ; September 2015' });

      const result = await FreighterService.connect();

      expect(result.network).toBe('Mainnet');
    });

    it('maps TESTNET network to Testnet', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: mockPublicKey });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });

      const result = await FreighterService.connect();

      expect(result.network).toBe('Testnet');
    });

    it('handles lowercase network names', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: mockPublicKey });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'public', networkPassphrase: 'Public Global Stellar Network ; September 2015' });

      const result = await FreighterService.connect();

      expect(result.network).toBe('Mainnet');
    });
  });

  describe('mapNetwork', () => {
    it('maps PUBLIC to Mainnet', () => {
      expect(FreighterService.mapNetwork('PUBLIC')).toBe('Mainnet');
    });

    it('maps public to Mainnet (case insensitive)', () => {
      expect(FreighterService.mapNetwork('public')).toBe('Mainnet');
    });

    it('maps TESTNET to Testnet', () => {
      expect(FreighterService.mapNetwork('TESTNET')).toBe('Testnet');
    });

    it('maps testnet to Testnet', () => {
      expect(FreighterService.mapNetwork('testnet')).toBe('Testnet');
    });

    it('defaults to Testnet for unknown networks', () => {
      expect(FreighterService.mapNetwork('UNKNOWN')).toBe('Testnet');
    });
  });

  describe('isNetworkMismatch', () => {
    it('returns true when networks do not match', () => {
      expect(FreighterService.isNetworkMismatch('Mainnet', 'Testnet')).toBe(true);
      expect(FreighterService.isNetworkMismatch('Testnet', 'Mainnet')).toBe(true);
    });

    it('returns false when networks match', () => {
      expect(FreighterService.isNetworkMismatch('Testnet', 'Testnet')).toBe(false);
      expect(FreighterService.isNetworkMismatch('Mainnet', 'Mainnet')).toBe(false);
    });
  });
});
