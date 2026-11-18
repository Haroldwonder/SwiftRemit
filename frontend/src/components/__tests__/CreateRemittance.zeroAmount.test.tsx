import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CreateRemittance, { amountToStroops } from '../CreateRemittance.tsx'

describe('CreateRemittance zero amount rejection (#1887)', () => {
  it('rejects amounts that convert to zero stroops', () => {
    expect(() => amountToStroops('0')).toThrow(/greater than zero/i)
    expect(() => amountToStroops('0.0000000')).toThrow(/greater than zero/i)
    // A genuinely positive value still converts normally.
    expect(amountToStroops('0.0000001')).toBe(1n)
  })

  it('shows an error and does not submit a zero-amount remittance', async () => {
    render(
      <CreateRemittance
        walletAddress="GTEST"
        contractId="test-contract"
        whitelistedTokens={['USDC']}
      />
    )

    const amountInput = screen.getByPlaceholderText('100.00')
    fireEvent.change(amountInput, { target: { value: '0' } })
    fireEvent.submit(amountInput.closest('form')!)

    await waitFor(() => {
      expect(screen.getByText(/greater than zero/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/created successfully/i)).not.toBeInTheDocument()
  })
})
