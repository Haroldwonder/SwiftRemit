/**
 * Tests for the optional memo field in SendMoneyFlow.
 *
 * Covers:
 * - Memo input renders on step 3 with correct placeholder
 * - Character count updates as user types
 * - Memo is included in onConfirm payload when provided
 * - Memo is absent from payload when left empty
 * - Memo is shown in review summary when provided
 * - Memo is hidden from review summary when empty
 * - Submission is not blocked when memo is empty
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SendMoneyFlow } from '../SendMoneyFlow';

const VALID_RECIPIENT = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Advance to step 3 (recipient + memo step) */
function advanceToStep3() {
  render(<SendMoneyFlow />);
  // Step 1 – amount
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  // Step 2 – asset
  fireEvent.change(screen.getByLabelText(/asset/i), { target: { value: 'USDC' } });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
}

/** Advance through all steps to confirmation, optionally setting a memo */
async function submitFlow(memo?: string) {
  const onConfirm = vi.fn().mockResolvedValueOnce(undefined);
  render(<SendMoneyFlow onConfirm={onConfirm} />);

  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));

  fireEvent.change(screen.getByLabelText(/asset/i), { target: { value: 'USDC' } });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));

  fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: VALID_RECIPIENT } });
  if (memo !== undefined) {
    fireEvent.change(screen.getByLabelText(/memo/i), { target: { value: memo } });
  }
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));

  // Step 4 – review
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));

  // Step 5 – confirm
  fireEvent.click(screen.getByRole('button', { name: /confirm transaction/i }));

  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  return onConfirm;
}

describe('SendMoneyFlow – memo field', () => {
  it('renders memo input on step 3', () => {
    advanceToStep3();
    expect(screen.getByLabelText(/memo/i)).toBeInTheDocument();
  });

  it('memo input has correct placeholder', () => {
    advanceToStep3();
    expect(screen.getByPlaceholderText(/invoice #1234/i)).toBeInTheDocument();
  });

  it('shows character count starting at 0/100', () => {
    advanceToStep3();
    expect(screen.getByText('0/100')).toBeInTheDocument();
  });

  it('updates character count as user types', () => {
    advanceToStep3();
    fireEvent.change(screen.getByLabelText(/memo/i), { target: { value: 'Hello' } });
    expect(screen.getByText('5/100')).toBeInTheDocument();
  });

  it('does not allow more than 100 characters', () => {
    advanceToStep3();
    const over = 'A'.repeat(110);
    fireEvent.change(screen.getByLabelText(/memo/i), { target: { value: over } });
    const input = screen.getByLabelText(/memo/i) as HTMLInputElement;
    // The component slices to 100
    expect(input.value.length).toBeLessThanOrEqual(100);
  });

  it('does not block submission when memo is empty', async () => {
    const onConfirm = await submitFlow('');
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('includes memo in payload when provided', async () => {
    const onConfirm = await submitFlow('Invoice #42');
    const [payload] = onConfirm.mock.calls[0];
    expect(payload.memo).toBe('Invoice #42');
  });

  it('omits memo from payload when left empty', async () => {
    const onConfirm = await submitFlow('');
    const [payload] = onConfirm.mock.calls[0];
    expect(payload.memo).toBeUndefined();
  });

  it('shows memo in review summary when provided', () => {
    render(<SendMoneyFlow />);

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    fireEvent.change(screen.getByLabelText(/asset/i), { target: { value: 'USDC' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: VALID_RECIPIENT } });
    fireEvent.change(screen.getByLabelText(/memo/i), { target: { value: 'REF-001' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Now on step 4 (review)
    expect(screen.getByText('REF-001')).toBeInTheDocument();
  });

  it('hides memo from review summary when empty', () => {
    render(<SendMoneyFlow />);

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    fireEvent.change(screen.getByLabelText(/asset/i), { target: { value: 'USDC' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    fireEvent.change(screen.getByLabelText(/recipient/i), { target: { value: VALID_RECIPIENT } });
    // leave memo empty
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Step 4 – memo row should not appear
    expect(screen.queryByText(/^memo$/i)).not.toBeInTheDocument();
  });
});
