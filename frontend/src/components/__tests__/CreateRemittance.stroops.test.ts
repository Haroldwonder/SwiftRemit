import { describe, expect, it } from 'vitest'
import {
  MEMO_MAX_BYTES,
  amountToStroops,
  memoByteLength,
  memoValidationError,
  truncateToBytes,
} from '../CreateRemittance.tsx'

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
})

describe('CreateRemittance memo byte limit (#1893)', () => {
  it('limits memos to 28 UTF-8 bytes', () => {
    expect(MEMO_MAX_BYTES).toBe(28)
    expect(memoByteLength('Invoice #1234')).toBe(13)
    expect(memoByteLength('é')).toBe(2)
    expect(memoByteLength('😀')).toBe(4)
  })

  it('accepts memos within the byte limit and rejects longer ones', () => {
    expect(memoValidationError('a'.repeat(28))).toBeNull()
    expect(memoValidationError('a'.repeat(29))).toBe(
      'Memo must be at most 28 bytes (UTF-8); currently 29 bytes.'
    )
    // 14 two-byte characters = 28 bytes (fits), 15 = 30 bytes (too long).
    expect(memoValidationError('é'.repeat(14))).toBeNull()
    expect(memoValidationError('é'.repeat(15))).toContain('30 bytes')
  })

  it('truncates on code point boundaries without exceeding the byte limit', () => {
    expect(truncateToBytes('a'.repeat(40))).toBe('a'.repeat(28))
    expect(truncateToBytes('é'.repeat(20))).toBe('é'.repeat(14))
    expect(truncateToBytes('😀'.repeat(10))).toBe('😀'.repeat(7))
    expect(memoByteLength(truncateToBytes('😀'.repeat(10)))).toBeLessThanOrEqual(MEMO_MAX_BYTES)
  })
})
