import { Router, Request, Response } from 'express';

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
