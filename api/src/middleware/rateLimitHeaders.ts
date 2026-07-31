import { Request, Response, NextFunction } from 'express';
import rateLimit, { Options } from 'express-rate-limit';

/**
 * Rate limiter tiers with their respective limits.
 * Used to determine the most restrictive limit when multiple limiters apply.
 */
export interface RateLimitTier {
  name: string;
  windowMs: number;
  maxRequests: number;
}

/**
 * Configure rate limiter with RFC 6585 headers and Retry-After on 429
 */
export function createRateLimitMiddleware(options?: Partial<Options>) {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000');
  const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100');

  return rateLimit({
    windowMs,
    max: maxRequests,
    message: {
      success: false,
      error: {
        message: 'Too many requests from this IP, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
      timestamp: new Date().toISOString(),
    },
    standardHeaders: 'draft-7', // RFC 6585: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
    legacyHeaders: false,   // Disable X-RateLimit-* headers
    // Add Retry-After header on 429 responses (RFC 6585 + all RateLimit-* headers)
    handler: (_req: Request, res: Response) => {
      const resetTime = new Date(Date.now() + windowMs);
      const retryAfterSeconds = Math.ceil(windowMs / 1000);

      res.status(429).set({
        'RateLimit-Limit': maxRequests.toString(),
        'RateLimit-Remaining': '0',
        'RateLimit-Reset': resetTime.toISOString(),
        'Retry-After': retryAfterSeconds.toString(),
      }).json({
        success: false,
        error: {
          message: 'Too many requests from this IP, please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: retryAfterSeconds,
          resetAt: resetTime.toISOString(),
        },
        timestamp: new Date().toISOString(),
      });
    },
    ...options,
  });
}

/**
 * Get rate limit tiers configuration from environment
 */
export function getRateLimitTiers(): Record<string, RateLimitTier> {
  return {
    global: {
      name: 'global',
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    },
    perKey: {
      name: 'per-key',
      windowMs: parseInt(process.env.API_KEY_RATE_LIMIT_WINDOW_MS || '60000'),
      maxRequests: parseInt(process.env.API_KEY_RATE_LIMIT_MAX || '200'),
    },
    admin: {
      name: 'admin',
      windowMs: parseInt(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || '60000'),
      maxRequests: parseInt(process.env.ADMIN_RATE_LIMIT_MAX || '500'),
    },
    webhook: {
      name: 'webhook',
      windowMs: parseInt(process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS || '60000'),
      maxRequests: parseInt(process.env.WEBHOOK_RATE_LIMIT_MAX || '1000'),
    },
  };
}

/**
 * Middleware to ensure rate limit headers are present on every response.
 * Express-rate-limit already adds these headers, but this middleware ensures
 * they're always present even if the rate limiter doesn't fire.
 */
export function addRateLimitHeaders(_req: Request, res: Response, next: NextFunction) {
  // If headers are already set by express-rate-limit, don't override
  if (!res.getHeader('RateLimit-Limit')) {
    const tiers = getRateLimitTiers();
    const globalTier = tiers.global;
    
    // Use global tier as default
    const resetTime = new Date(Date.now() + globalTier.windowMs);
    
    res.set({
      'RateLimit-Limit': globalTier.maxRequests.toString(),
      'RateLimit-Remaining': globalTier.maxRequests.toString(),
      'RateLimit-Reset': resetTime.toISOString(),
    });
  }
  
  next();
}

/**
 * Create a rate limiter for a specific tier (per-key, admin, webhook)
 */
export function createTieredRateLimiter(tier: keyof ReturnType<typeof getRateLimitTiers>) {
  const tiers = getRateLimitTiers();
  const config = tiers[tier];
  
  return createRateLimitMiddleware({
    windowMs: config.windowMs,
    max: config.maxRequests,
  });
}
