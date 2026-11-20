import { describe, expect, it } from 'vitest'
import { amountToStroops } from '../CreateRemittance.tsx'

describe('CreateRemittance TSX amount conversion (#1728)', () => {
  it('preserves seven decimal places without floating-point rounding', () => {
    expect(amountToStroops('1.0000001')).toBe(10000001n)
    expect(amountToStroops('0.0000001')).toBe(1n)
    expect(amountToStroops('2.50')).toBe(25000000n)
  })

  it('rejects malformed or excessive precision', () => {
    expect(() => amountToStroops('-1')).toThrow()
    expect(() => amountToStroops('oops')).toThrow()
    expect(() => amountToStroops('0.12345678')).toThrow()
  })

  it('rejects amounts that convert to zero stroops (#1887)', () => {
    expect(() => amountToStroops('0')).toThrow('Amount must be greater than 0')
    expect(() => amountToStroops('0.0000000')).toThrow('Amount must be greater than 0')
    expect(() => amountToStroops('0.0')).toThrow('Amount must be greater than 0')
  })
})
