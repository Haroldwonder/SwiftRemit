/**
 * SR-184 regression test: KycStatusScreen must call kycService.getStatus with
 * the anchor tied to the user's actual context, not the hardcoded testnet
 * constant 'testanchor.stellar.org'.
 */
import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import KycStatusScreen from '../../screens/KycStatusScreen';
import { kycService, anchorService } from '../../services/api';
import * as SecureStore from 'expo-secure-store';
import { Linking } from 'react-native';
import { KycStatus } from '../../types';

jest.mock('../../services/api', () => ({
  kycService: {
    getStatus: jest.fn(),
  },
  anchorService: {
    getAvailableAnchors: jest.fn(),
  },
}));

const mockGetStatus = kycService.getStatus as jest.Mock;
const mockGetAvailableAnchors = anchorService.getAvailableAnchors as jest.Mock;
const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;

function makeStatus(kyc_status: KycStatus['kyc_status'], overrides: Partial<KycStatus> = {}): KycStatus {
  return {
    user_id: 'user-1',
    anchor_id: 'anchor-prod-123',
    kyc_status,
    updated_at: '2026-04-01T12:00:00Z',
    ...overrides,
  };
}

describe('KycStatusScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: wallet present, last_anchor_id stored, no country context needed
    mockGetItemAsync.mockImplementation(async (key: string) => {
      if (key === 'wallet_address') return 'wallet-xyz';
      if (key === 'last_anchor_id') return 'anchor-prod-123';
      return null;
    });
    mockGetStatus.mockResolvedValue(makeStatus('approved'));
  });

  // ── Loading state ──────────────────────────────────────────────────────
  it('shows a spinner while loading', async () => {
    mockGetStatus.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = await render(<KycStatusScreen />);
    expect(getByTestId('loading-indicator')).toBeTruthy();
  });

  // ── SR-184 regression: anchor must come from user context ──────────────
  it('calls kycService.getStatus with the stored last_anchor_id, not the testnet constant', async () => {
    const { getByText } = await render(<KycStatusScreen />);
    await waitFor(() => expect(getByText('Verified')).toBeTruthy());

    expect(mockGetStatus).toHaveBeenCalledWith('wallet-xyz', 'anchor-prod-123');
    // Explicitly assert it was NOT called with the hardcoded testnet value
    expect(mockGetStatus).not.toHaveBeenCalledWith('wallet-xyz', 'testanchor.stellar.org');
  });

  it('falls back to anchorService when no last_anchor_id is stored', async () => {
    mockGetItemAsync.mockImplementation(async (key: string) => {
      if (key === 'wallet_address') return 'wallet-xyz';
      if (key === 'last_anchor_id') return null;
      if (key === 'last_recipient_country') return 'PH';
      if (key === 'last_recipient_currency') return 'PHP';
      return null;
    });
    mockGetAvailableAnchors.mockResolvedValue([
      { anchor_id: 'anchor-from-service', name: 'Test Anchor', country: 'PH', currency: 'PHP', availability: 'available', settlement_time_hours: 1, fee_percentage: 1 },
    ]);
    mockGetStatus.mockResolvedValue(makeStatus('pending'));

    const { getByText } = await render(<KycStatusScreen />);
    await waitFor(() => expect(getByText('Under Review')).toBeTruthy());

    expect(mockGetAvailableAnchors).toHaveBeenCalledWith('PH', 'PHP');
    expect(mockGetStatus).toHaveBeenCalledWith('wallet-xyz', 'anchor-from-service');
    expect(mockGetStatus).not.toHaveBeenCalledWith('wallet-xyz', 'testanchor.stellar.org');
  });

  it('shows "no anchor context" error when neither stored anchor nor anchorService resolves', async () => {
    mockGetItemAsync.mockImplementation(async (key: string) => {
      if (key === 'wallet_address') return 'wallet-xyz';
      return null; // no last_anchor_id, no country, no currency
    });
    mockGetAvailableAnchors.mockResolvedValue([]);

    const { getByText } = await render(<KycStatusScreen />);
    await waitFor(() =>
      expect(getByText('No anchor context found. Please complete a transfer first.')).toBeTruthy()
    );

    expect(mockGetStatus).not.toHaveBeenCalled();
  });

  // ── Error state (not logged in) ────────────────────────────────────────
  it('shows "Not logged in" when no wallet is stored', async () => {
    mockGetItemAsync.mockResolvedValue(null);
    const { getByText } = await render(<KycStatusScreen />);
    await waitFor(() => {
      expect(getByText('Not logged in')).toBeTruthy();
    });
  });

  it('shows error text when the API rejects', async () => {
    mockGetStatus.mockRejectedValue(new Error('Network error'));
    const { getByText } = await render(<KycStatusScreen />);
    await waitFor(() => {
      expect(getByText('Failed to load KYC status.')).toBeTruthy();
    });
  });

  // ── Approved state ─────────────────────────────────────────────────────
  it('shows "Verified" badge for approved status', async () => {
    const { getByText } = await render(<KycStatusScreen />);
    await waitFor(() => expect(getByText('Verified')).toBeTruthy());
    expect(getByText('Your identity is verified. You can send money.')).toBeTruthy();
  });

  it('does not render the re-submit button for approved status', async () => {
    const { queryByText } = await render(<KycStatusScreen />);
    await waitFor(() => expect(queryByText('Start / Re-submit Verification')).toBeNull());
  });

  // ── Pending state ──────────────────────────────────────────────────────
  it('shows "Under Review" badge for pending status', async () => {
    mockGetStatus.mockResolvedValue(makeStatus('pending'));
    const { getByText } = await render(<KycStatusScreen />);
    await waitFor(() => expect(getByText('Under Review')).toBeTruthy());
  });

  // ── Not-started state ──────────────────────────────────────────────────
  it('shows "Not Started" badge and a re-submit button for not_started', async () => {
    mockGetStatus.mockResolvedValue(makeStatus('not_started'));
    const { getByText } = await render(<KycStatusScreen />);
    await waitFor(() => expect(getByText('Not Started')).toBeTruthy());
    expect(getByText('Start / Re-submit Verification')).toBeTruthy();
  });

  it('opens the KYC URL when the re-submit button is pressed', async () => {
    mockGetStatus.mockResolvedValue(makeStatus('not_started'));
    const { getByText } = await render(<KycStatusScreen />);
    await waitFor(() => expect(getByText('Start / Re-submit Verification')).toBeTruthy());
    fireEvent.press(getByText('Start / Re-submit Verification'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://swiftremit.app/kyc');
  });

  // ── Denied state ───────────────────────────────────────────────────────
  it('shows "Denied" badge and the rejection reason', async () => {
    mockGetStatus.mockResolvedValue(
      makeStatus('denied', { rejection_reason: 'Document unclear' })
    );
    const { getByText } = await render(<KycStatusScreen />);
    await waitFor(() => expect(getByText('Denied')).toBeTruthy());
    expect(getByText('Reason: Document unclear')).toBeTruthy();
    expect(getByText('Start / Re-submit Verification')).toBeTruthy();
  });

  // ── Expired state ──────────────────────────────────────────────────────
  it('shows "Expired" badge and a re-submit button for expired status', async () => {
    mockGetStatus.mockResolvedValue(makeStatus('expired'));
    const { getByText } = await render(<KycStatusScreen />);
    await waitFor(() => expect(getByText('Expired')).toBeTruthy());
    expect(getByText('Start / Re-submit Verification')).toBeTruthy();
  });

  // ── Fields needed ──────────────────────────────────────────────────────
  it('renders the required-fields section when fields_needed is present', async () => {
    mockGetStatus.mockResolvedValue(
      makeStatus('pending', { fields_needed: ['id_front', 'selfie'] })
    );
    const { getByText } = await render(<KycStatusScreen />);
    await waitFor(() => expect(getByText('Required fields:')).toBeTruthy());
    expect(getByText('• id_front')).toBeTruthy();
    expect(getByText('• selfie')).toBeTruthy();
  });
});
