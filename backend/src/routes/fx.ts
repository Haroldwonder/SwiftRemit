import { Router, Request, Response } from 'express';
import { saveFxRate, getFxRate } from '../database';
import { getFxRateCache } from '../fx-rate-cache';
import { sanitizeInput } from '../sanitizer';

export function createFxRouter(): Router {
  const router = Router();
  const fxRateCache = getFxRateCache();

  // POST /api/fx-rate
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { transactionId, rate, provider, fromCurrency, toCurrency } = req.body;
      if (!transactionId || typeof transactionId !== 'string') return res.status(400).json({ error: 'Invalid transaction ID' });
      if (!rate || typeof rate !== 'number' || rate <= 0) return res.status(400).json({ error: 'Invalid rate' });
      if (!provider || typeof provider !== 'string') return res.status(400).json({ error: 'Invalid provider' });
      if (!fromCurrency || !toCurrency) return res.status(400).json({ error: 'Invalid currencies' });
      await saveFxRate({
        transaction_id: sanitizeInput(transactionId),
        rate,
        provider: sanitizeInput(provider),
        timestamp: new Date(),
        from_currency: sanitizeInput(String(fromCurrency)),
        to_currency: sanitizeInput(String(toCurrency)),
      });
      res.json({ success: true, message: 'FX rate stored successfully' });
    } catch (error) {
      console.error('Error storing FX rate:', error);
      res.status(500).json({ error: 'Failed to store FX rate' });
    }
  });

  // GET /api/fx-rate/current  — must be before /:transactionId to avoid param capture
  router.get('/current', async (req: Request, res: Response) => {
    try {
      const { from, to } = req.query;
      if (!from || typeof from !== 'string' || from.length > 10) return res.status(400).json({ error: 'Invalid from currency' });
      if (!to || typeof to !== 'string' || to.length > 10) return res.status(400).json({ error: 'Invalid to currency' });
      const rate = await fxRateCache.getCurrentRate(from.toUpperCase(), to.toUpperCase());
      res.json(rate);
    } catch (error) {
      console.error('Error fetching current FX rate:', error);
      res.status(500).json({ error: 'Failed to fetch current FX rate' });
    }
  });

  // GET /api/fx-rate/:transactionId
  router.get('/:transactionId', async (req: Request, res: Response) => {
    try {
      const { transactionId } = req.params;
      if (!transactionId) return res.status(400).json({ error: 'Invalid transaction ID' });
      const fxRate = await getFxRate(transactionId);
      if (!fxRate) return res.status(404).json({ error: 'FX rate not found for this transaction' });
      res.json({ ...fxRate, fx_rate_source: fxRate.provider });
    } catch (error) {
      console.error('Error fetching FX rate:', error);
      res.status(500).json({ error: 'Failed to fetch FX rate' });
    }
  });

  return router;
}
