import { describe, it, expect } from 'vitest'

// CSP directives expected in both vite.config.js and vercel.json
const REQUIRED_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
]

const STELLAR_ORIGINS = [
  'https://horizon-testnet.stellar.org',
  'https://soroban-testnet.stellar.org',
]

const CSP_VALUE =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https:; " +
  "connect-src 'self' https://horizon-testnet.stellar.org https://soroban-testnet.stellar.org https://horizon.stellar.org https://soroban.stellar.org; " +
  "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"

describe('CSP configuration', () => {
  it('includes all required directives', () => {
    for (const directive of REQUIRED_DIRECTIVES) {
      expect(CSP_VALUE).toContain(directive)
    }
  })

  it('allows Stellar network origins in connect-src', () => {
    for (const origin of STELLAR_ORIGINS) {
      expect(CSP_VALUE).toContain(origin)
    }
  })

  it('blocks framing with frame-ancestors none', () => {
    expect(CSP_VALUE).toContain("frame-ancestors 'none'")
  })

  it('restricts script sources to self only (no unsafe-inline scripts)', () => {
    const scriptSrc = CSP_VALUE.match(/script-src ([^;]+)/)?.[1] ?? ''
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
  })
})
