import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

const windowMs = parseInt(process.env.API_KEY_RATE_LIMIT_WINDOW_MS ?? '60000', 10);
const max = parseInt(process.env.API_KEY_RATE_LIMIT_MAX ?? '200', 10);

export const apiKeyRateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (apiKey) return apiKey;
    const auth = req.headers.authorization;
    if (auth?.startsWith('ApiKey ')) return auth.slice(7);
    return req.ip ?? 'unknown';
  },
  handler: (_req: Request, res: Response) => {
    const retryAfter = Math.ceil(windowMs / 1000);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Rate limit exceeded', retryAfter });
  },
});
