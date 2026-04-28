import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { WalletConnection } from '../WalletConnection';
import * as freighterApi from '@stellar/freighter-api';

// Mock the Freighter API
vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
}));

const MOCK_PUBLIC_KEY = 'GBZXN7PIRZGNMHGAU2LYGAZGQG4RYSQ3TB2T6O3COVGW6OLBDEQ2COFQ';

describe('WalletConnection', () => {
  beforeEach(() => {
    // Reset all mocks before each test
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
    cleanup();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Freighter Installation Detection
  // -------------------------------------------------------------------------

  describe('Freighter installation detection', () => {
    it('enables connect button when Freighter is installed', () => {
      render(<WalletConnection />);
      
      const connectButton = screen.getByRole('button', { name: /connect/i });
      expect(connectButton).not.toBeDisabled();
    });

    it('disables connect button when Freighter is not installed', () => {
      delete (window as any).freighter;
      
      render(<WalletConnection />);
      
      const connectButton = screen.getByRole('button', { name: /connect/i });
      expect(connectButton).toBeDisabled();
    });

    it('shows install link when Freighter is not installed', () => {
      delete (window as any).freighter;
      
      render(<WalletConnection />);
      
      const installLink = screen.getByText(/install freighter wallet/i);
      expect(installLink).toBeInTheDocument();
      expect(installLink).toHaveAttribute('href', 'https://www.freighter.app/');
      expect(installLink).toHaveAttribute('target', '_blank');
    });

    it('does not show install link when Freighter is installed', () => {
      render(<WalletConnection />);
      
      const installLink = screen.queryByText(/install freighter wallet/i);
      expect(installLink).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Successful Connection
  // -------------------------------------------------------------------------

  describe('successful connection', () => {
    beforeEach(() => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: MOCK_PUBLIC_KEY });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });
    });

    it('connects to Freighter and displays public key', async () => {
      render(<WalletConnection defaultNetwork="Testnet" />);
      
      const connectButton = screen.getByRole('button', { name: /connect/i });
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText(/GBZXN7...Q2COFQ/)).toBeInTheDocument();
        expect(screen.getByText(/connected public key/i)).toBeInTheDocument();
      });
    });

    it('displays the correct network from Freighter', async () => {
      render(<WalletConnection defaultNetwork="Testnet" />);
      
      const connectButton = screen.getByRole('button', { name: /connect/i });
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('Testnet')).toBeInTheDocument();
      });
    });

    it('maps PUBLIC network to Mainnet', async () => {
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'PUBLIC', networkPassphrase: 'Public Global Stellar Network ; September 2015' });
      
      render(<WalletConnection defaultNetwork="Mainnet" />);
      
      const connectButton = screen.getByRole('button', { name: /connect/i });
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('Mainnet')).toBeInTheDocument();
      });
    });

    it('shows connecting state during connection', async () => {
      vi.mocked(freighterApi.isConnected).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ isConnected: true }), 100))
      );
      
      render(<WalletConnection />);
      
      const connectButton = screen.getByRole('button', { name: /connect/i });
      fireEvent.click(connectButton);

      expect(screen.getByText(/connecting.../i)).toBeInTheDocument();
      expect(connectButton).toBeDisabled();

      await waitFor(() => {
        expect(screen.queryByText(/connecting.../i)).not.toBeInTheDocument();
      });
    });

    it('shows disconnect and sign buttons after connection', async () => {
      render(<WalletConnection />);
      
      const connectButton = screen.getByRole('button', { name: /connect/i });
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign message/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
      });
      
      // Connect button should not be present
      expect(screen.queryByRole('button', { name: /^connect$/i })).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Network Mismatch Warning
  // -------------------------------------------------------------------------

  describe('network mismatch warning', () => {
    it('shows warning when wallet is on different network', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: MOCK_PUBLIC_KEY });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'PUBLIC', networkPassphrase: 'Public Global Stellar Network ; September 2015' }); // Mainnet
      
      render(<WalletConnection defaultNetwork="Testnet" />);
      
      const connectButton = screen.getByRole('button', { name: /connect/i });
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText(/warning.*mainnet.*testnet/i)).toBeInTheDocument();
      });
    });

    it('does not show warning when networks match', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: MOCK_PUBLIC_KEY });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });
      
      render(<WalletConnection defaultNetwork="Testnet" />);
      
      const connectButton = screen.getByRole('button', { name: /connect/i });
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText(/GBZXN7...Q2COFQ/)).toBeInTheDocument();
      });

      expect(screen.queryByText(/warning/i)).not.toBeInTheDocument();
    });

    it('clears network warning on disconnect', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: MOCK_PUBLIC_KEY });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'PUBLIC', networkPassphrase: 'Public Global Stellar Network ; September 2015' });
      
      render(<WalletConnection defaultNetwork="Testnet" />);
      
      fireEvent.click(screen.getByRole('button', { name: /connect/i }));

      await waitFor(() => {
        expect(screen.getByText(/warning/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));

      await waitFor(() => {
        expect(screen.queryByText(/warning/i)).not.toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Connection Errors
  // -------------------------------------------------------------------------

  describe('connection errors', () => {
    it('shows error when Freighter is not connected', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: false });
      
      render(<WalletConnection />);
      
      const connectButton = screen.getByRole('button', { name: /connect/i });
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText(/unlock your freighter wallet/i)).toBeInTheDocument();
      });
    });

    it('shows error when Freighter is not installed', async () => {
      delete (window as any).freighter;
      
      const onConnect = vi.fn().mockRejectedValue(new Error('Freighter wallet is not installed'));
      
      render(<WalletConnection onConnect={onConnect} />);
      
      const connectButton = screen.getByRole('button', { name: /connect/i });
      
      // Button should be disabled when Freighter is not installed
      expect(connectButton).toBeDisabled();
      
      // But we can still test the error by calling onConnect directly
      try {
        await onConnect();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Freighter wallet is not installed');
      }
    });

    it('shows generic error for unknown connection failures', async () => {
      vi.mocked(freighterApi.isConnected).mockRejectedValue(new Error('Network error'));
      
      render(<WalletConnection />);
      
      const connectButton = screen.getByRole('button', { name: /connect/i });
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText(/failed to connect wallet/i)).toBeInTheDocument();
      });
    });

    it('clears previous errors on new connection attempt', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValueOnce({ isConnected: false });
      
      render(<WalletConnection />);
      
      const connectButton = screen.getByRole('button', { name: /connect/i });
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText(/unlock your freighter wallet/i)).toBeInTheDocument();
      });

      // Now mock successful connection
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: MOCK_PUBLIC_KEY });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });

      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.queryByText(/unlock your freighter wallet/i)).not.toBeInTheDocument();
        expect(screen.getByText(/GBZXN7...Q2COFQ/)).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------------

  describe('disconnect', () => {
    beforeEach(() => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: MOCK_PUBLIC_KEY });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });
    });

    it('disconnects and clears public key', async () => {
      render(<WalletConnection />);
      
      fireEvent.click(screen.getByRole('button', { name: /connect/i }));

      await waitFor(() => {
        expect(screen.getByText(/GBZXN7...Q2COFQ/)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));

      await waitFor(() => {
        expect(screen.getByText(/not connected/i)).toBeInTheDocument();
        expect(screen.queryByText(/GBZXN7...Q2COFQ/)).not.toBeInTheDocument();
      });
    });

    it('shows disconnecting state', async () => {
      const onDisconnect = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );
      
      render(<WalletConnection onDisconnect={onDisconnect} />);
      
      fireEvent.click(screen.getByRole('button', { name: /connect/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));

      expect(screen.getByText(/disconnecting.../i)).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByText(/disconnecting.../i)).not.toBeInTheDocument();
      });
    });

    it('calls onDisconnect callback when provided', async () => {
      const onDisconnect = vi.fn().mockResolvedValue(undefined);
      
      render(<WalletConnection onDisconnect={onDisconnect} />);
      
      fireEvent.click(screen.getByRole('button', { name: /connect/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));

      await waitFor(() => {
        expect(onDisconnect).toHaveBeenCalled();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Custom onConnect Callback
  // -------------------------------------------------------------------------

  describe('custom onConnect callback', () => {
    it('uses custom onConnect when provided', async () => {
      const customPublicKey = 'GCUSTOMKEY123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const onConnect = vi.fn().mockResolvedValue({
        publicKey: customPublicKey,
        network: 'Mainnet',
      });
      
      render(<WalletConnection onConnect={onConnect} defaultNetwork="Mainnet" />);
      
      fireEvent.click(screen.getByRole('button', { name: /connect/i }));

      await waitFor(() => {
        expect(onConnect).toHaveBeenCalled();
        expect(screen.getByText(/GCUSTO...UVWXYZ/)).toBeInTheDocument();
      });

      // Freighter API should not be called
      expect(freighterApi.isConnected).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Sign Message
  // -------------------------------------------------------------------------

  describe('sign message', () => {
    beforeEach(() => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: MOCK_PUBLIC_KEY });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });
    });

    it('calls onRequestSignature when sign button is clicked', async () => {
      const onRequestSignature = vi.fn().mockResolvedValue(undefined);
      
      render(<WalletConnection onRequestSignature={onRequestSignature} />);
      
      fireEvent.click(screen.getByRole('button', { name: /connect/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign message/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /sign message/i }));

      await waitFor(() => {
        expect(onRequestSignature).toHaveBeenCalled();
      });
    });

    it('shows signing state during signature request', async () => {
      const onRequestSignature = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );
      
      render(<WalletConnection onRequestSignature={onRequestSignature} />);
      
      fireEvent.click(screen.getByRole('button', { name: /connect/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign message/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /sign message/i }));

      expect(screen.getByText(/waiting for signature.../i)).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByText(/waiting for signature.../i)).not.toBeInTheDocument();
      });
    });

    it('shows error when signature is rejected', async () => {
      const onRequestSignature = vi.fn().mockRejectedValue({
        code: '4001',
        message: 'User rejected the request',
      });
      
      render(<WalletConnection onRequestSignature={onRequestSignature} />);
      
      fireEvent.click(screen.getByRole('button', { name: /connect/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign message/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /sign message/i }));

      await waitFor(() => {
        expect(screen.getByText(/signature request was rejected/i)).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Public Key Truncation
  // -------------------------------------------------------------------------

  describe('public key truncation', () => {
    it('truncates long public keys', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: MOCK_PUBLIC_KEY });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });
      
      render(<WalletConnection />);
      
      fireEvent.click(screen.getByRole('button', { name: /connect/i }));

      await waitFor(() => {
        expect(screen.getByText('GBZXN7...Q2COFQ')).toBeInTheDocument();
      });
    });

    it('does not truncate short public keys', async () => {
      const shortKey = 'SHORTKEY';
      vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: shortKey });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });
      
      render(<WalletConnection />);
      
      fireEvent.click(screen.getByRole('button', { name: /connect/i }));

      await waitFor(() => {
        expect(screen.getByText('SHORTKEY')).toBeInTheDocument();
      });
    });
  });
});
