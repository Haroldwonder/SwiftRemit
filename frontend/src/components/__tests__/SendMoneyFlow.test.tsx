import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SendMoneyFlow } from '../SendMoneyFlow';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Valid Stellar public key: G followed by exactly 55 uppercase base32 chars (total 56)
const VALID_RECIPIENT = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA';
const INVALID_RECIPIENT = 'not-a-stellar-key';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk through steps 1-3 filling in valid data, landing on step 4 (Review). */
async function fillAndAdvanceToReview(
  amount = '100',
  asset = 'USDC',
  recipient = VALID_RECIPIENT
) {
  // Step 1 – amount
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: amount } });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));

  // Step 2 – asset
  fireEvent.change(screen.getByLabelText(/asset/i), { target: { value: asset } });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));

  // Step 3 – recipient
  fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: recipient } });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SendMoneyFlow', () => {
  // -------------------------------------------------------------------------
  // Initial render
  // -------------------------------------------------------------------------

  describe('initial render', () => {
    it('renders step 1 with amount input', () => {
      render(<SendMoneyFlow />);
      expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    });

    it('back button is disabled on step 1', () => {
      render(<SendMoneyFlow />);
      expect(screen.getByRole('button', { name: /back/i })).toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // Step navigation – forward
  // -------------------------------------------------------------------------

  describe('step navigation – forward', () => {
    it('advances from step 1 to step 2 with a valid amount', () => {
      render(<SendMoneyFlow />);
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '50' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/step 2 of 5/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/asset/i)).toBeInTheDocument();
    });

    it('advances from step 2 to step 3 after selecting an asset', () => {
      render(<SendMoneyFlow />);
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '50' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      fireEvent.change(screen.getByLabelText(/asset/i), { target: { value: 'XLM' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      expect(screen.getByText(/step 3 of 5/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/recipient/i)).toBeInTheDocument();
    });

    it('advances from step 3 to step 4 with a valid Stellar key', () => {
      render(<SendMoneyFlow />);
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '50' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      fireEvent.change(screen.getByLabelText(/asset/i), { target: { value: 'XLM' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      fireEvent.change(screen.getByLabelText(/recipient/i), {
        target: { value: VALID_RECIPIENT },
      });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      expect(screen.getByText(/step 4 of 5/i)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Step navigation – back
  // -------------------------------------------------------------------------

  describe('step navigation – back', () => {
    it('goes back from step 2 to step 1', () => {
      render(<SendMoneyFlow />);
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '50' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/step 2 of 5/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /back/i }));
      expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
    });

    it('clears the error when navigating back', () => {
      render(<SendMoneyFlow />);
      // Trigger a validation error on step 1
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/amount is required/i)).toBeInTheDocument();

      // Enter valid amount and advance, then go back
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '10' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      fireEvent.click(screen.getByRole('button', { name: /back/i }));

      expect(screen.queryByText(/amount is required/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Amount validation
  // -------------------------------------------------------------------------

  describe('amount validation', () => {
    it('shows error when amount is empty', () => {
      render(<SendMoneyFlow />);
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/amount is required/i)).toBeInTheDocument();
    });

    it('shows error when amount is zero', () => {
      render(<SendMoneyFlow />);
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '0' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/amount must be greater than zero/i)).toBeInTheDocument();
    });

    it('shows error when amount is negative', () => {
      render(<SendMoneyFlow />);
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '-5' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/amount must be greater than zero/i)).toBeInTheDocument();
    });

    it('shows error when amount is non-numeric', () => {
      render(<SendMoneyFlow />);
      // type="number" inputs discard non-numeric strings, resulting in an empty value
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: 'abc' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/amount is required/i)).toBeInTheDocument();
    });

    it('does not advance when amount is invalid', () => {
      render(<SendMoneyFlow />);
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '0' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Asset validation
  // -------------------------------------------------------------------------

  describe('asset validation', () => {
    beforeEach(() => {
      render(<SendMoneyFlow />);
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '50' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    });

    it('shows error when no asset is selected', () => {
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/please select an asset/i)).toBeInTheDocument();
    });

    it('does not advance when no asset is selected', () => {
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/step 2 of 5/i)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Recipient validation
  // -------------------------------------------------------------------------

  describe('recipient validation', () => {
    beforeEach(() => {
      render(<SendMoneyFlow />);
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '50' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      fireEvent.change(screen.getByLabelText(/asset/i), { target: { value: 'USDC' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    });

    it('shows error for an invalid Stellar key', () => {
      fireEvent.change(screen.getByLabelText(/recipient/i), {
        target: { value: INVALID_RECIPIENT },
      });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/valid stellar public key/i)).toBeInTheDocument();
    });

    it('shows error when recipient is empty', () => {
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/valid stellar public key/i)).toBeInTheDocument();
    });

    it('does not advance with an invalid recipient', () => {
      fireEvent.change(screen.getByLabelText(/recipient/i), {
        target: { value: INVALID_RECIPIENT },
      });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/step 3 of 5/i)).toBeInTheDocument();
    });

    it('accepts a valid Stellar public key and advances', () => {
      fireEvent.change(screen.getByLabelText(/recipient/i), {
        target: { value: VALID_RECIPIENT },
      });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText(/step 4 of 5/i)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Review summary (step 4)
  // -------------------------------------------------------------------------

  describe('review summary', () => {
    it('displays entered amount, asset, and recipient on the review step', async () => {
      render(<SendMoneyFlow />);
      await fillAndAdvanceToReview('250', 'EURC', VALID_RECIPIENT);

      expect(screen.getByText('250')).toBeInTheDocument();
      expect(screen.getByText('EURC')).toBeInTheDocument();
      expect(screen.getByText(VALID_RECIPIENT)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Successful submission
  // -------------------------------------------------------------------------

  describe('successful submission', () => {
    it('calls onConfirm with the correct payload', async () => {
      const onConfirm = vi.fn().mockResolvedValueOnce(undefined);
      render(<SendMoneyFlow onConfirm={onConfirm} />);

      await fillAndAdvanceToReview('100', 'USDC', VALID_RECIPIENT);

      // Advance to step 5
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      fireEvent.click(screen.getByRole('button', { name: /confirm transaction/i }));

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledOnce();
        expect(onConfirm).toHaveBeenCalledWith({
          amount: 100,
          asset: 'USDC',
          recipient: VALID_RECIPIENT,
        });
      });
    });

    it('shows success message after confirmed transaction', async () => {
      const onConfirm = vi.fn().mockResolvedValueOnce(undefined);
      render(<SendMoneyFlow onConfirm={onConfirm} />);

      await fillAndAdvanceToReview('100', 'USDC', VALID_RECIPIENT);
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      fireEvent.click(screen.getByRole('button', { name: /confirm transaction/i }));

      await waitFor(() => {
        expect(screen.getByText(/transaction confirmed successfully/i)).toBeInTheDocument();
      });
    });

    it('amount in payload is a number, not a string', async () => {
      const onConfirm = vi.fn().mockResolvedValueOnce(undefined);
      render(<SendMoneyFlow onConfirm={onConfirm} />);

      await fillAndAdvanceToReview('42.5', 'XLM', VALID_RECIPIENT);
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      fireEvent.click(screen.getByRole('button', { name: /confirm transaction/i }));

      await waitFor(() => {
        const [payload] = onConfirm.mock.calls[0];
        expect(typeof payload.amount).toBe('number');
        expect(payload.amount).toBe(42.5);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Failed submission
  // -------------------------------------------------------------------------

  describe('failed submission', () => {
    it('displays error message when onConfirm rejects', async () => {
      const onConfirm = vi.fn().mockRejectedValueOnce(new Error('Network error'));
      render(<SendMoneyFlow onConfirm={onConfirm} />);

      await fillAndAdvanceToReview('100', 'USDC', VALID_RECIPIENT);
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      fireEvent.click(screen.getByRole('button', { name: /confirm transaction/i }));

      await waitFor(() => {
        expect(screen.getByText(/transaction failed/i)).toBeInTheDocument();
      });
    });

    it('re-enables the confirm button after a failed submission', async () => {
      const onConfirm = vi.fn().mockRejectedValueOnce(new Error('Timeout'));
      render(<SendMoneyFlow onConfirm={onConfirm} />);

      await fillAndAdvanceToReview('100', 'USDC', VALID_RECIPIENT);
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      fireEvent.click(screen.getByRole('button', { name: /confirm transaction/i }));

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /confirm transaction/i })
        ).not.toBeDisabled();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Submitting state
  // -------------------------------------------------------------------------

  describe('submitting state', () => {
    it('disables the confirm button while submitting', async () => {
      // Never resolves – keeps component in submitting state
      const onConfirm = vi.fn().mockReturnValueOnce(new Promise(() => {}));
      render(<SendMoneyFlow onConfirm={onConfirm} />);

      await fillAndAdvanceToReview('100', 'USDC', VALID_RECIPIENT);
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      fireEvent.click(screen.getByRole('button', { name: /confirm transaction/i }));

      expect(screen.getByRole('button', { name: /confirming/i })).toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // Custom assets prop
  // -------------------------------------------------------------------------

  describe('custom assets prop', () => {
    it('renders only the provided assets in the select', () => {
      render(<SendMoneyFlow assets={['BTC', 'ETH']} />);
      fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '10' } });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      expect(screen.getByRole('option', { name: 'BTC' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'ETH' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'XLM' })).not.toBeInTheDocument();
    });
  });
});
