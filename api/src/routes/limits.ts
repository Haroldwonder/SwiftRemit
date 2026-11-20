import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { getCurrencyCacheMaxAge } from '../config';
import { currencyCodeSchema, countryCodeSchema } from '../schemas/requestValidation';
import { sendInternalError } from '../middleware/errorHandler';

const router = Router();

/**
 * #1878 — Build a strong, content-derived ETag for a response payload.
 */
function buildStrongETag(payload: unknown): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('base64url');
  return `"${digest}"`;
}

/**
 * #1878 — Send a cacheable JSON response with `Cache-Control` and a strong
 * `ETag`, answering `304 Not Modified` when `If-None-Match` matches.
 */
function sendCacheableJson(req: Request, res: Response, payload: unknown): Response {
  const etag = buildStrongETag(payload);
  res.setHeader('Cache-Control', `public, max-age=${getCurrencyCacheMaxAge()}`);
  res.setHeader('ETag', etag);

  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch) {
    const candidates = String(ifNoneMatch)
      .split(',')
      .map(tag => tag.trim().replace(/^W\//, ''));
    if (candidates.includes(etag) || candidates.includes('*')) {
      return res.status(304).end();
    }
  }

  return res.json(payload);
}

/**
 * Default corridor limits. In production these would come from the smart
 * contract's `get_daily_limit` query or a database.
 */
const DEFAULT_LIMITS = {
  min: 1,
  max: 10000,
  dailyLimit: 5000,
};

/**
 * GET /api/limits?asset=USDC&country=NG
 * Returns min/max amounts and daily send limit for a corridor.
 */
router.get('/', (req: Request, res: Response) => {
  const asset = typeof req.query.asset === 'string' ? req.query.asset.toUpperCase() : 'USDC';
  const country = typeof req.query.country === 'string' ? req.query.country.toUpperCase() : '';

  // Validate query parameters
  const assetValidation = currencyCodeSchema.validate(asset);
  if (assetValidation.error) {
    return res.status(400).json({
      success: false,
      error: {
        message: `Invalid asset: ${assetValidation.error.message}`,
        code: 'INVALID_ASSET',
      },
      timestamp: new Date().toISOString(),
    });
  }

  if (country) {
    const countryValidation = countryCodeSchema.validate(country);
    if (countryValidation.error) {
      return res.status(400).json({
        success: false,
        error: {
          message: `Invalid country: ${countryValidation.error.message}`,
          code: 'INVALID_COUNTRY',
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Corridor-specific overrides (extensible)
  const corridorKey = `${asset}:${country}`;
  const overrides: Record<string, Partial<typeof DEFAULT_LIMITS>> = {
    'USDC:NG': { max: 5000, dailyLimit: 3000 },
    'USDC:GH': { max: 4000, dailyLimit: 2500 },
    'XLM:NG': { max: 50000, dailyLimit: 30000 },
  };

  const limits = { ...DEFAULT_LIMITS, ...(overrides[corridorKey] ?? {}) };

  return sendCacheableJson(req, res, {
    success: true,
    data: {
      asset,
      country: country || null,
      min: limits.min,
      max: limits.max,
      dailyLimit: limits.dailyLimit,
      // Remaining daily limit — in production this would be per-user from the contract
      dailyRemaining: limits.dailyLimit,
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;

/**
 * GET /api/limits/:currency/:country
 * Returns the corridor-specific daily limit for a currency/country pair.
 */
router.get('/:currency/:country', (req: Request<{ currency: string; country: string }>, res: Response) => {
  const currency = req.params.currency.toUpperCase();
  const country = req.params.country.toUpperCase();

  const currencyValidation = currencyCodeSchema.validate(currency);
  if (currencyValidation.error) {
    return res.status(400).json({
      success: false,
      error: { message: `Invalid currency: ${currencyValidation.error.message}`, code: 'INVALID_CURRENCY' },
      timestamp: new Date().toISOString(),
    });
  }

  const countryValidation = countryCodeSchema.validate(country);
  if (countryValidation.error) {
    return res.status(400).json({
      success: false,
      error: { message: `Invalid country: ${countryValidation.error.message}`, code: 'INVALID_COUNTRY' },
      timestamp: new Date().toISOString(),
    });
  }

  const corridorKey = `${currency}:${country}`;
  const overrides: Record<string, Partial<typeof DEFAULT_LIMITS>> = {
    'USDC:NG': { max: 5000, dailyLimit: 3000 },
    'USDC:GH': { max: 4000, dailyLimit: 2500 },
    'XLM:NG': { max: 50000, dailyLimit: 30000 },
  };

  const limits = { ...DEFAULT_LIMITS, ...(overrides[corridorKey] ?? {}) };

  return sendCacheableJson(req, res, {
    success: true,
    data: {
      currency,
      country,
      min: limits.min,
      max: limits.max,
      dailyLimit: limits.dailyLimit,
      dailyRemaining: limits.dailyLimit,
    },
    timestamp: new Date().toISOString(),
  });
});
