import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProofOfPayout } from '../ProofOfPayout';
import * as horizonServiceModule from '../../services/horizonService';

// Mock the horizon service
vi.mock('../../services/horizonService', () => ({
  horizonService: {
    fetchCompletedEvent: vi.fn(),
    getStellarExpertLink: vi.fn((hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`),
  },
  HorizonService: vi.fn(),
}));

describe('ProofOfPayout', () => {
  const mockEventData = {
    remittanceId: '42',
    sender: 'SENDER_ADDRESS_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
    agent: 'AGENT_ADDRESS_ABCDEFGHIJKLMNOPQRSTUVWXYZ789012',
    amount: '10000000',
    fee: '50000',
    asset: 'USDC_ADDRESS',
    timestamp: '2024-01-01T00:00:00Z',
    transactionHash: 'abc123def456',
    ledgerSequence: 12345,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display loading state initially', () => {
    vi.mocked(horizonServiceModule.horizonService.fetchCompletedEvent).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<ProofOfPayout remittanceId={42} />);

    expect(screen.getByText('Loading payout details...')).toBeInTheDocument();
  });

  it('should display event data when fetch is successful', async () => {
    vi.mocked(horizonServiceModule.horizonService.fetchCompletedEvent).mockResolvedValue(mockEventData);

    render(<ProofOfPayout remittanceId={42} />);

    await waitFor(() => {
      expect(screen.getByText('Transaction Details')).toBeInTheDocument();
    });

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('SENDER...123456')).toBeInTheDocument();
    expect(screen.getByText('AGENT_...789012')).toBeInTheDocument();
    expect(screen.getByText('1.0000000 USDC')).toBeInTheDocument();
    expect(screen.getByText('0.0050000 USDC')).toBeInTheDocument();
  });

  it('should display error message when fetch fails', async () => {
    vi.mocked(horizonServiceModule.horizonService.fetchCompletedEvent).mockRejectedValue(
      new Error('Network error')
    );

    render(<ProofOfPayout remittanceId={42} />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('should display error when no event is found', async () => {
    vi.mocked(horizonServiceModule.horizonService.fetchCompletedEvent).mockResolvedValue(null);

    render(<ProofOfPayout remittanceId={42} />);

    await waitFor(() => {
      expect(screen.getByText('No completed event found for this remittance ID')).toBeInTheDocument();
    });
  });

  it('should display Stellar Expert link with correct URL', async () => {
    vi.mocked(horizonServiceModule.horizonService.fetchCompletedEvent).mockResolvedValue(mockEventData);

    render(<ProofOfPayout remittanceId={42} />);

    await waitFor(() => {
      const link = screen.getByText('View on Stellar Expert →');
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute(
        'href',
        'https://stellar.expert/explorer/testnet/tx/abc123def456'
      );
    });
  });

  it('should truncate long addresses correctly', async () => {
    vi.mocked(horizonServiceModule.horizonService.fetchCompletedEvent).mockResolvedValue(mockEventData);

    render(<ProofOfPayout remittanceId={42} />);

    await waitFor(() => {
      expect(screen.getByText('SENDER...123456')).toBeInTheDocument();
    });
  });

  it('should format amounts correctly from stroops', async () => {
    vi.mocked(horizonServiceModule.horizonService.fetchCompletedEvent).mockResolvedValue({
      ...mockEventData,
      amount: '100000000', // 10 USDC
      fee: '1000000', // 0.1 USDC
    });

    render(<ProofOfPayout remittanceId={42} />);

    await waitFor(() => {
      expect(screen.getByText('10.0000000 USDC')).toBeInTheDocument();
      expect(screen.getByText('0.1000000 USDC')).toBeInTheDocument();
    });
  });

  it('should format timestamp correctly', async () => {
    vi.mocked(horizonServiceModule.horizonService.fetchCompletedEvent).mockResolvedValue(mockEventData);

    render(<ProofOfPayout remittanceId={42} />);

    await waitFor(() => {
      const label = screen.getByText('Timestamp:');
      const value = label.nextElementSibling?.textContent ?? '';
      expect(value).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    });
  });

  it('should not display camera when onRelease is not provided', async () => {
    vi.mocked(horizonServiceModule.horizonService.fetchCompletedEvent).mockResolvedValue(mockEventData);

    render(<ProofOfPayout remittanceId={42} />);

    await waitFor(() => {
      expect(screen.getByText('Transaction Details')).toBeInTheDocument();
    });

    // Camera-related elements should not be present
    expect(screen.queryByText('Capture an image as proof')).not.toBeInTheDocument();
    expect(screen.queryByText('Capture')).not.toBeInTheDocument();
  });

  it('should display camera when onRelease callback is provided', async () => {
    vi.mocked(horizonServiceModule.horizonService.fetchCompletedEvent).mockResolvedValue(mockEventData);
    const mockOnRelease = vi.fn();

    // Mock getUserMedia
    const mockGetUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia: mockGetUserMedia },
      writable: true,
    });

    render(<ProofOfPayout remittanceId={42} onRelease={mockOnRelease} />);

    await waitFor(() => {
      expect(screen.getByText(/Capture an image as proof/)).toBeInTheDocument();
    });
  });
});
