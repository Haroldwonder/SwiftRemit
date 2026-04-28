import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { VerificationBadge, VerificationStatus, AssetVerification } from '../VerificationBadge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

function makeVerification(overrides: Partial<AssetVerification> = {}): AssetVerification {
  return {
    asset_code: 'USDC',
    issuer: ISSUER,
    status: VerificationStatus.Verified,
    reputation_score: 95,
    last_verified: '2026-02-23T10:30:00Z',
    trustline_count: 15000,
    has_toml: true,
    stellar_expert_verified: true,
    community_reports: 0,
    ...overrides,
  };
}

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response);
}

// ---------------------------------------------------------------------------
// Global setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  global.fetch = vi.fn();
  window.prompt = vi.fn();
  window.alert = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VerificationBadge', () => {
  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  describe('loading state', () => {
    it('renders loading indicator before fetch resolves', () => {
      // Never resolves — keeps component in loading state
      (global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise(() => {}));

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Verified state
  // -------------------------------------------------------------------------

  describe('verified state', () => {
    it('renders verified badge with correct text and score', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => makeVerification() });

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} />);

      await waitFor(() => {
        expect(screen.getByText('Verified')).toBeInTheDocument();
        expect(screen.getByText('95/100')).toBeInTheDocument();
      });
    });

    it('renders checkmark icon for verified asset', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => makeVerification() });

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} />);

      await waitFor(() => {
        expect(screen.getByText('✓')).toBeInTheDocument();
      });
    });

    it('sets correct aria-label for verified asset', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => makeVerification() });

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /asset verification status: verified/i })
        ).toBeInTheDocument();
      });
    });

    it('does not auto-show warning modal for verified assets', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => makeVerification() });

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} />);

      await waitFor(() => expect(screen.getByText('Verified')).toBeInTheDocument());

      expect(screen.queryByText('⚠ Asset Warning')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Unverified state
  // -------------------------------------------------------------------------

  describe('unverified state', () => {
    it('renders unverified badge when API returns 404', async () => {
      mockFetchOnce({ ok: false, status: 404 });

      render(<VerificationBadge assetCode="UNKNOWN" issuer={ISSUER} />);

      await waitFor(() => {
        expect(screen.getByText('Unverified')).toBeInTheDocument();
      });
    });

    it('renders unverified badge when status is Unverified', async () => {
      mockFetchOnce({
        ok: true,
        status: 200,
        json: async () => makeVerification({ status: VerificationStatus.Unverified }),
      });

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} />);

      await waitFor(() => {
        expect(screen.getByText('Unverified')).toBeInTheDocument();
      });
    });

    it('renders question-mark icon for unverified asset', async () => {
      mockFetchOnce({ ok: false, status: 404 });

      render(<VerificationBadge assetCode="UNKNOWN" issuer={ISSUER} />);

      await waitFor(() => {
        expect(screen.getByText('?')).toBeInTheDocument();
      });
    });

    it('calls onWarning callback for unverified assets', async () => {
      const onWarning = vi.fn();
      const unverifiedData = makeVerification({ status: VerificationStatus.Unverified });

      mockFetchOnce({ ok: true, status: 200, json: async () => unverifiedData });

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} onWarning={onWarning} />);

      await waitFor(() => {
        expect(onWarning).toHaveBeenCalledWith(unverifiedData);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Suspicious state
  // -------------------------------------------------------------------------

  describe('suspicious state', () => {
    const suspiciousData = makeVerification({
      status: VerificationStatus.Suspicious,
      reputation_score: 15,
      community_reports: 5,
    });

    it('renders suspicious badge with correct text', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => suspiciousData });

      render(<VerificationBadge assetCode="SCAM" issuer={ISSUER} />);

      await waitFor(() => {
        expect(screen.getByText('Suspicious')).toBeInTheDocument();
      });
    });

    it('renders warning icon for suspicious asset', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => suspiciousData });

      render(<VerificationBadge assetCode="SCAM" issuer={ISSUER} />);

      await waitFor(() => {
        expect(screen.getByText('⚠')).toBeInTheDocument();
      });
    });

    it('auto-shows warning modal for suspicious assets', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => suspiciousData });

      render(<VerificationBadge assetCode="SCAM" issuer={ISSUER} />);

      await waitFor(() => {
        expect(screen.getByText('⚠ Asset Warning')).toBeInTheDocument();
      });
    });

    it('warning modal displays asset code and reputation score', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => suspiciousData });

      render(<VerificationBadge assetCode="SCAM" issuer={ISSUER} />);

      await waitFor(() => {
        expect(screen.getByText('⚠ Asset Warning')).toBeInTheDocument();
        // asset_code comes from the API response, not the prop
        expect(screen.getByText('USDC')).toBeInTheDocument();
        // score appears in both badge and modal — just confirm at least one exists
        expect(screen.getAllByText(/15/).length).toBeGreaterThanOrEqual(1);
      });
    });

    it('dismisses warning modal when "I Understand" is clicked', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => suspiciousData });

      render(<VerificationBadge assetCode="SCAM" issuer={ISSUER} />);

      await waitFor(() => expect(screen.getByText('⚠ Asset Warning')).toBeInTheDocument());

      fireEvent.click(screen.getByText('I Understand'));

      await waitFor(() => {
        expect(screen.queryByText('⚠ Asset Warning')).not.toBeInTheDocument();
      });
    });

    it('"View Details" in warning modal opens details modal', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => suspiciousData });

      render(<VerificationBadge assetCode="SCAM" issuer={ISSUER} />);

      await waitFor(() => expect(screen.getByText('⚠ Asset Warning')).toBeInTheDocument());

      fireEvent.click(screen.getByText('View Details'));

      await waitFor(() => {
        expect(screen.queryByText('⚠ Asset Warning')).not.toBeInTheDocument();
        expect(screen.getByText('Asset Verification Details')).toBeInTheDocument();
      });
    });

    it('calls onWarning callback for suspicious assets', async () => {
      const onWarning = vi.fn();

      mockFetchOnce({ ok: true, status: 200, json: async () => suspiciousData });

      render(<VerificationBadge assetCode="SCAM" issuer={ISSUER} onWarning={onWarning} />);

      await waitFor(() => {
        expect(onWarning).toHaveBeenCalledWith(suspiciousData);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Details modal
  // -------------------------------------------------------------------------

  describe('details modal', () => {
    it('opens details modal on badge click', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => makeVerification() });

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} />);

      await waitFor(() => expect(screen.getByText('Verified')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /asset verification status/i }));

      await waitFor(() => {
        expect(screen.getByText('Asset Verification Details')).toBeInTheDocument();
      });
    });

    it('closes details modal when close button is clicked', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => makeVerification() });

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} />);

      await waitFor(() => expect(screen.getByText('Verified')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /asset verification status/i }));
      await waitFor(() => expect(screen.getByText('Asset Verification Details')).toBeInTheDocument());

      fireEvent.click(screen.getByText('×'));

      await waitFor(() => {
        expect(screen.queryByText('Asset Verification Details')).not.toBeInTheDocument();
      });
    });

    it('does not open modal when showDetails is false', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => makeVerification() });

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} showDetails={false} />);

      await waitFor(() => expect(screen.getByText('Verified')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /asset verification status/i }));

      expect(screen.queryByText('Asset Verification Details')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Report submission
  // -------------------------------------------------------------------------

  describe('report submission', () => {
    it('submits report and shows success alert', async () => {
      (window.prompt as ReturnType<typeof vi.fn>).mockReturnValue('Looks like a scam');

      mockFetchOnce({ ok: true, status: 200, json: async () => makeVerification() });
      mockFetchOnce({ ok: true, status: 200, json: async () => ({ success: true }) });
      mockFetchOnce({ ok: true, status: 200, json: async () => makeVerification() });

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} />);

      await waitFor(() => expect(screen.getByText('Verified')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /asset verification status/i }));
      await waitFor(() => expect(screen.getByText('Report as Suspicious')).toBeInTheDocument());

      fireEvent.click(screen.getByText('Report as Suspicious'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/verification/report'),
          expect.objectContaining({ method: 'POST' })
        );
        expect(window.alert).toHaveBeenCalledWith(
          expect.stringContaining('successfully')
        );
      });
    });

    it('shows failure alert when report POST fails', async () => {
      (window.prompt as ReturnType<typeof vi.fn>).mockReturnValue('Suspicious');

      mockFetchOnce({ ok: true, status: 200, json: async () => makeVerification() });
      mockFetchOnce({ ok: false, status: 500 });

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} />);

      await waitFor(() => expect(screen.getByText('Verified')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /asset verification status/i }));
      await waitFor(() => expect(screen.getByText('Report as Suspicious')).toBeInTheDocument());

      fireEvent.click(screen.getByText('Report as Suspicious'));

      await waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed'));
      });
    });

    it('does not submit report when prompt is cancelled', async () => {
      (window.prompt as ReturnType<typeof vi.fn>).mockReturnValue(null);

      mockFetchOnce({ ok: true, status: 200, json: async () => makeVerification() });

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} />);

      await waitFor(() => expect(screen.getByText('Verified')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /asset verification status/i }));
      await waitFor(() => expect(screen.getByText('Report as Suspicious')).toBeInTheDocument());

      fireEvent.click(screen.getByText('Report as Suspicious'));

      // Only the initial GET should have been called — no POST
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // API error handling
  // -------------------------------------------------------------------------

  describe('API error handling', () => {
    it('renders unverified badge on network error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error')
      );

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} />);

      await waitFor(() => {
        expect(screen.getByText('Unverified')).toBeInTheDocument();
      });
    });

    it('renders unverified badge on non-404 server error', async () => {
      mockFetchOnce({ ok: false, status: 500 });

      render(<VerificationBadge assetCode="USDC" issuer={ISSUER} />);

      await waitFor(() => {
        expect(screen.getByText('Unverified')).toBeInTheDocument();
      });
    });

    it('calls fetch with the correct URL', async () => {
      mockFetchOnce({ ok: true, status: 200, json: async () => makeVerification() });

      render(
        <VerificationBadge
          assetCode="USDC"
          issuer={ISSUER}
          apiUrl="http://localhost:4000"
        />
      );

      await waitFor(() => expect(screen.getByText('Verified')).toBeInTheDocument());

      expect(global.fetch).toHaveBeenCalledWith(
        `http://localhost:4000/api/verification/USDC/${ISSUER}`
      );
    });
  });
});
