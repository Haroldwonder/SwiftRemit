import { Request, Response, NextFunction } from 'express';
import rateLimit, { Options } from 'express-rate-limit';

/**
 * Configure rate limiter with RFC 6585 headers enabled
 */
export function createRateLimitMiddleware(options?: Partial<Options>) {
  return rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    message: {
      success: false,
      error: {
        message: 'Too many requests from this IP, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
      timestamp: new Date().toISOString(),
    },
    standardHeaders: true, // RFC 6585: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
    legacyHeaders: false,   // Disable X-RateLimit-* headers
    ...options,
  });
}

/**
 * Middleware to add rate limit info to response headers
 */
export function addRateLimitHeaders(req: Request, res: Response, next: NextFunction) {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000');
  const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100');
  
  res.set({
    'RateLimit-Limit': maxRequests.toString(),
    'RateLimit-Reset': new Date(Date.now() + windowMs).toISOString(),
  });
  
  next();
}
