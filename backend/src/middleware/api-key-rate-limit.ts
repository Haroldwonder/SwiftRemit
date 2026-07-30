/**
 * API Key Rate Limiting & Scope Enforcement (SR-043)
 *
 * Replaces the flat per-IP limiter with:
 *   1. Per-key rate-limit tiers (free / standard / premium)
 *   2. Scope enforcement — 403 when the key lacks the required scope
 *   3. Standard RateLimit-* headers on every authenticated response
 *   4. Revoked / expired keys rejected with 401 immediately
 *
 * Unauthenticated requests fall through to the existing IP-based limiter
 * that wraps all /api/ routes in api.ts.
 */

import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import {
  ApiKeyStore,
  TIER_CONFIGS,
  RateLimitTier,
  requiredScopeForRoute,
  ApiKeyScope,
} from './api-key-store';

// ── Per-tier rate-limit instances ────────────────────────────────────────────
// We create one limiter per tier, keyed on the API key string so buckets are
// per-key (not per-IP).

function makeTierLimiter(tier: RateLimitTier): RateLimitRequestHandler {
  const { maxRequests, windowMs } = TIER_CONFIGS[tier];
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: 'draft-7',   // RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
    legacyHeaders: false,
    keyGenerator: (req: Request): string => extractKeyFromRequest(req) ?? req.ip ?? 'unknown',
    handler: (_req: Request, res: Response) => {
      const retryAfter = Math.ceil(windowMs / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Rate limit exceeded', retryAfter });
    },
    skip: (req: Request) => {
      // Only apply this tier limiter when the request carries an API key
      return !extractKeyFromRequest(req);
    },
  });
}

const tierLimiters: Record<RateLimitTier, RateLimitRequestHandler> = {
  free:     makeTierLimiter('free'),
  standard: makeTierLimiter('standard'),
  premium:  makeTierLimiter('premium'),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function extractKeyFromRequest(req: Request): string | undefined {
  const xApiKey = req.headers['x-api-key'] as string | undefined;
  if (xApiKey) return xApiKey;
  const auth = req.headers.authorization;
  if (auth?.startsWith('ApiKey ')) return auth.slice(7);
  return undefined;
}

// ── Factory ───────────────────────────────────────────────────────────────────

let _store: ApiKeyStore | null = null;

export function initApiKeyMiddleware(pool: Pool): void {
  _store = new ApiKeyStore(pool);
  // Ensure the table exists — fire-and-forget at startup
  _store.initTable().catch((err) =>
    console.error('[api-key] Failed to initialise api_keys table', err),
  );
}

// ── Main middleware ───────────────────────────────────────────────────────────

/**
 * scopedApiKeyMiddleware
 *
 * Runs in three phases for every request that carries an API key:
 *   1. Validate — resolve the key hash, check active/expiry
 *   2. Scope     — verify the key has the required scope for this route
 *   3. Rate-limit — apply the per-tier bucket limiter
 *
 * Requests without an API key are passed through; the outer IP-based
 * limiter in api.ts handles them.
 */
export async function scopedApiKeyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const plaintext = extractKeyFromRequest(req);

  // No API key — let the request continue (public / IP-limited routes)
  if (!plaintext) {
    return next();
  }

  if (!_store) {
    // Store not initialised (test environments that skip initApiKeyMiddleware)
    return next();
  }

  // ── 1. Validate key ────────────────────────────────────────────────────────
  const record = await _store.lookupByKey(plaintext);

  if (!record) {
    res.status(401).json({ error: 'Invalid, revoked, or expired API key' });
    return;
  }

  // ── 2. Scope check ─────────────────────────────────────────────────────────
  const required = requiredScopeForRoute(req.method, req.path);

  if (required !== null && !ApiKeyStore.hasScope(record, required)) {
    res.status(403).json({
      error: 'Insufficient scope',
      required_scope: required,
      key_scopes:     record.scopes,
    });
    return;
  }

  // Attach the resolved record so downstream handlers can read scopes/tier
  (req as any).apiKey = record;

  // ── 3. Per-tier rate limit ──────────────────────────────────────────────────
  const limiter = tierLimiters[record.tier] ?? tierLimiters.free;
  limiter(req, res, next);
}

// ── Legacy export (preserves backward-compat import in api.ts) ───────────────

/**
 * Flat IP/key-based limiter used as the outer guard over all /api/ routes.
 * Kept for backward compatibility; the scope/tier logic is in
 * scopedApiKeyMiddleware above.
 */
export const apiKeyRateLimiter = rateLimit({
  windowMs: parseInt(process.env.API_KEY_RATE_LIMIT_WINDOW_MS ?? '60000', 10),
  max:      parseInt(process.env.API_KEY_RATE_LIMIT_MAX ?? '200', 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request): string => extractKeyFromRequest(req) ?? req.ip ?? 'unknown',
  handler: (_req: Request, res: Response) => {
    const windowMs = parseInt(process.env.API_KEY_RATE_LIMIT_WINDOW_MS ?? '60000', 10);
    const retryAfter = Math.ceil(windowMs / 1000);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Rate limit exceeded', retryAfter });
  },
});
