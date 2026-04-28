import { Router, Request, Response } from 'express';
import { currencyCodeSchema, countryCodeSchema, validateRequest } from './schemas/requestValidation';

const router = Router();

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

  res.json({
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
