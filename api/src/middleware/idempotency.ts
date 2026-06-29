import { Request, Response, NextFunction } from 'express';
import Cache from 'node-cache';

const IDEMPOTENCY_CACHE_TTL = 86400; // 24 hours in seconds

interface CachedResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  timestamp: number;
}

/**
 * In-memory cache for idempotency responses
 * Production: Use Redis instead
 */
const idempotencyCache = new Cache({ stdTTL: IDEMPOTENCY_CACHE_TTL });

/**
 * Middleware to handle idempotency keys on POST requests
 * RFC 7231: Idempotent Methods & 7232 Cache
 */
export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'POST') {
    return next();
  }

  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey) {
    return next();
  }

  const cacheKey = `${req.path}:${idempotencyKey}`;
  const cached = idempotencyCache.get<CachedResponse>(cacheKey);

  if (cached) {
    res.status(cached.status);
    res.set('Idempotency-Key', idempotencyKey);
    res.set('Cache-Control', 'private, no-store');
    return res.json(cached.body);
  }

  // Override res.json to cache response
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    res.set('Idempotency-Key', idempotencyKey);
    res.set('Cache-Control', 'private, no-store');
    
    const response: CachedResponse = {
      status: res.statusCode,
      body,
      headers: {
        'Idempotency-Key': idempotencyKey,
        'Cache-Control': 'private, no-store',
      },
      timestamp: Date.now(),
    };
    idempotencyCache.set(cacheKey, response);
    return originalJson(body);
  };

  next();
}

/**
 * Validate idempotency key format (UUID v4 specifically)
 */
export function validateIdempotencyKey(key: string): boolean {
  // UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx where y is 8, 9, a, or b
  const uuidv4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidv4Pattern.test(key);
}

/**
 * Clear idempotency cache for testing
 */
export function clearIdempotencyCache(): void {
  idempotencyCache.flushAll();
}

/**
 * Get cache stats for monitoring
 */
export function getIdempotencyCacheStats() {
  return idempotencyCache.getStats();
}
