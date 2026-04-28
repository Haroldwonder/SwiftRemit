import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnchorSelector, AnchorProvider } from '../AnchorSelector';

describe('AnchorSelector', () => {
  const mockAnchor: AnchorProvider = {
    id: 'anchor-1',
    name: 'Test Anchor',
    domain: 'test-anchor.com',
    logo_url: 'https://example.com/logo.png',
    description: 'A test anchor provider',
    status: 'active',
    fees: {
      deposit_fee_percent: 1.5,
      deposit_fee_fixed: 0.5,
      withdrawal_fee_percent: 2.0,
      withdrawal_fee_fixed: 1.0,
      min_fee: 0.1,
      max_fee: 100,
    },
    limits: {
      min_amount: 10,
      max_amount: 50000,
      daily_limit: 100000,
      monthly_limit: 500000,
    },
    compliance: {
      kyc_required: true,
      kyc_level: 'intermediate',
      supported_countries: ['US', 'CA', 'MX'],
      restricted_countries: ['KP', 'IR'],
      documents_required: ['passport', 'proof_of_address'],
    },
    supported_currencies: ['USD', 'EUR', 'GBP'],
    processing_time: '1-2 business days',
    rating: 4.8,
    total_transactions: 15000,
    verified: true,
  };

  const mockAnchor2: AnchorProvider = {
    ...mockAnchor,
    id: 'anchor-2',
    name: 'Another Anchor',
    domain: 'another-anchor.com',
    rating: 4.5,
  };

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('should render loading state while fetching anchors', async () => {
    (global.fetch as any).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<AnchorSelector onSelect={vi.fn()} />);
    expect(screen.getByText('Loading anchor providers...')).toBeInTheDocument();
  });

  it('should render error state with retry button on fetch failure', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

    render(<AnchorSelector onSelect={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to connect to anchor service')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  it('should render anchor list and allow selection', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [mockAnchor, mockAnchor2],
      }),
    });

    const onSelect = vi.fn();
    render(<AnchorSelector onSelect={onSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Choose an anchor provider...')).toBeInTheDocument();
    });

    // Open dropdown
    fireEvent.click(screen.getByText('Choose an anchor provider...'));

    await waitFor(() => {
      expect(screen.getByText('Test Anchor')).toBeInTheDocument();
      expect(screen.getByText('Another Anchor')).toBeInTheDocument();
    });

    // Select first anchor
    fireEvent.click(screen.getByText('Test Anchor'));

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(mockAnchor);
    });
  });

  it('should display anchor details panel when an anchor is selected', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [mockAnchor],
      }),
    });

    render(<AnchorSelector onSelect={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Choose an anchor provider...')).toBeInTheDocument();
    });

    // Open dropdown and select
    fireEvent.click(screen.getByText('Choose an anchor provider...'));
    await waitFor(() => {
      expect(screen.getByText('Test Anchor')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Test Anchor'));

    // Show details
    await waitFor(() => {
      expect(screen.getByText(/Show Details/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Show Details/));

    await waitFor(() => {
      expect(screen.getByText('Fee Structure')).toBeInTheDocument();
      expect(screen.getByText('Transaction Limits')).toBeInTheDocument();
      expect(screen.getByText('Compliance Requirements')).toBeInTheDocument();
    });
  });

  it('should filter anchors by currency prop', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [mockAnchor],
      }),
    });

    render(<AnchorSelector onSelect={vi.fn()} currency="USD" />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('currency=USD')
      );
    });
  });

  it('should trigger onSelect callback when anchor is selected', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [mockAnchor],
      }),
    });

    const onSelect = vi.fn();
    render(<AnchorSelector onSelect={onSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Choose an anchor provider...')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Choose an anchor provider...'));
    await waitFor(() => {
      expect(screen.getByText('Test Anchor')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Test Anchor'));

    expect(onSelect).toHaveBeenCalledWith(mockAnchor);
  });

  it('should display verified badge for verified anchors', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [mockAnchor],
      }),
    });

    render(<AnchorSelector onSelect={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Choose an anchor provider...')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Choose an anchor provider...'));
    await waitFor(() => {
      const verifiedBadges = screen.getAllByText('✓');
      expect(verifiedBadges.length).toBeGreaterThan(0);
    });
  });

  it('should display anchor rating when available', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [mockAnchor],
      }),
    });

    render(<AnchorSelector onSelect={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Choose an anchor provider...')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Choose an anchor provider...'));
    await waitFor(() => {
      expect(screen.getByText('⭐ 4.8')).toBeInTheDocument();
    });
  });
});
