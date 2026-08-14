import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Shared CSP directives (applied in both dev server and production HTML).
// Keep connect-src in sync with any new API endpoints or Stellar services.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self' https://horizon.stellar.org https://horizon-testnet.stellar.org https://soroban-testnet.stellar.org https://soroban.stellar.org https://api.stellar.expert",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
]

// Enforcement CSP header value.
const CSP = CSP_DIRECTIVES.join('; ')

// Dev-server CSP — Vite's HMR client and React Fast Refresh inject inline
// <script> tags and rely on eval-based transforms, so script-src needs
// 'unsafe-inline'/'unsafe-eval' here. Production (built HTML + vercel.json)
// keeps the strict script-src 'self' from CSP_DIRECTIVES above.
const CSP_DEV = CSP_DIRECTIVES.map((directive) =>
  directive === "script-src 'self'"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : directive
).join('; ')

// Report-Only CSP header — used in staging to catch violations without
// blocking the page.  Switch from report-only to enforcement once no
// violations have appeared in staging for 48 hours.
const CSP_REPORT_ONLY = [
  ...CSP_DIRECTIVES,
  "report-uri /api/csp-report",
  "report-to csp-endpoint",
].join('; ')

/**
 * Vite plugin that injects the Content-Security-Policy <meta> tag into the
 * built HTML output.  This ensures the CSP is served even when the hosting
 * layer (Vercel, nginx) does not add a response header.
 *
 * Note: <meta http-equiv="Content-Security-Policy"> does not support
 * frame-ancestors or report-uri, which must be set as HTTP response headers
 * (see vercel.json).  The meta tag covers all other directives.
 */
function cspHtmlPlugin(reportOnly = false) {
  const headerName = reportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy'
  const cspValue = reportOnly ? CSP_REPORT_ONLY : CSP

  return {
    name: 'csp-html-meta',
    // Build only — the dev server sets its own (relaxed) CSP via
    // server.headers above. Running this in dev too would inject the strict
    // production script-src as a <meta> tag, and CSP header + meta tag are
    // enforced as an intersection, silently overriding the relaxed header.
    apply: 'build',
    transformIndexHtml(html) {
      const metaTag = `<meta http-equiv="${headerName}" content="${cspValue}">`
      return html.replace('<head>', `<head>\n    ${metaTag}`)
    },
  }
}

export default defineConfig(({ mode }) => {
  const isStaging = process.env.DEPLOY_ENV === 'staging'

  return {
    plugins: [
      react(),
      // Inject CSP meta tag into the built HTML.
      // Staging uses Report-Only so violations are captured without breakage.
      cspHtmlPlugin(isStaging),
    ],

    server: {
      headers: {
        // Dev server: enforce CSP so developers see violations early, with
        // script-src relaxed for Vite's own HMR/Fast-Refresh inline scripts.
        'Content-Security-Policy': CSP_DEV,
      },
    },

    build: {
      // Emit source maps only in non-production modes.
      sourcemap: mode !== 'production',
    },
  }
})
