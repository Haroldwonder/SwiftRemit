/**
 * Shared CORS allowlist builder.
 *
 * `cors()` with no options defaults to `origin: '*'`, which lets any
 * third-party site's client-side JavaScript call these APIs directly from a
 * visitor's browser. Both `backend/src/api.ts` and `api/src/app.ts` were
 * running with that default. This builds an explicit allowlist from the
 * ALLOWED_ORIGINS env var instead, and only turns on `credentials: true`
 * (required for the cookie-based `/api/auth/refresh` flow — see
 * `api/AUTH_MATRIX.md`) for origins that are actually on the allowlist.
 *
 * Consumed by both `backend/` and `api/` — see shared/src/logger.ts for the
 * same relative-import pattern.
 */

import type { CorsOptions } from 'cors';

/** Parses a comma-separated ALLOWED_ORIGINS value into a clean origin list. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Builds `cors()` options from an explicit allowlist.
 *
 * - No `Origin` header (server-to-server, curl, health checks): allowed,
 *   no ACAO header is sent back — there's no browser origin to protect.
 * - Origin on the allowlist: reflected back with `credentials: true`, so
 *   the refresh-token cookie flow works for the SwiftRemit frontend.
 * - Origin not on the allowlist: rejected — the `cors` package responds
 *   without an `Access-Control-Allow-Origin` header, which is what makes
 *   the browser block the cross-origin response.
 * - Empty allowlist (misconfigured env): fails closed — every browser
 *   origin is rejected rather than silently falling back to `*`.
 */
export function buildCorsOptions(allowedOrigins: string[]): CorsOptions {
  return {
    origin(requestOrigin, callback) {
      if (!requestOrigin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(requestOrigin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin '${requestOrigin}' is not allowed by CORS policy`));
    },
    credentials: true,
    optionsSuccessStatus: 204,
  };
}

/** Convenience: build CORS options directly from the ALLOWED_ORIGINS env var. */
export function corsOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  return buildCorsOptions(parseAllowedOrigins(env.ALLOWED_ORIGINS));
}
