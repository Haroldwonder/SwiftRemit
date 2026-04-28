import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self' https://horizon-testnet.stellar.org https://soroban-testnet.stellar.org https://horizon.stellar.org https://soroban.stellar.org",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Content-Security-Policy': CSP,
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
    },
  },
})
