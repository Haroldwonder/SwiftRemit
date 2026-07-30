import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { Sep24Service, Sep24InitiateRequest, Sep24ConfigError, Sep24AnchorError } from '../sep24-service';
import { sanitizeInput } from '../sanitizer';

export function createAnchorRouter(pool: Pool): Router {
  const router = Router();

  let sep24Service: Sep24Service | null = null;
  async function getSep24(): Promise<Sep24Service> {
    if (!sep24Service) {
      sep24Service = new Sep24Service(pool);
      await sep24Service.initialize();
    }
    return sep24Service;
  }

  // POST /api/anchor/initiate
  router.post('/initiate', async (req: Request, res: Response) => {
    try {
      const { user_id, anchor_id, direction, asset_code, amount, user_address, user_email } = req.body;
      if (!user_id || typeof user_id !== 'string') return res.status(400).json({ error: 'Invalid or missing user_id' });
      if (!anchor_id || typeof anchor_id !== 'string') return res.status(400).json({ error: 'Invalid or missing anchor_id' });
      if (!direction || (direction !== 'deposit' && direction !== 'withdrawal')) return res.status(400).json({ error: 'Invalid direction (must be deposit or withdrawal)' });
      if (!asset_code || typeof asset_code !== 'string') return res.status(400).json({ error: 'Invalid or missing asset_code' });
      if (!amount || typeof amount !== 'string' || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Invalid or missing amount' });

      const service = await getSep24();
      const request: Sep24InitiateRequest = {
        user_id: sanitizeInput(user_id),
        anchor_id: sanitizeInput(anchor_id),
        direction: direction as 'deposit' | 'withdrawal',
        asset_code: sanitizeInput(asset_code),
        amount,
        user_address: user_address ? sanitizeInput(String(user_address)) : user_address,
        user_email: user_email ? sanitizeInput(String(user_email)) : user_email,
      };
      const result = await service.initiateFlow(request);
      res.json({ success: true, transaction_id: result.transaction_id, url: result.url, message: result.message });
    } catch (error) {
      if (error instanceof Sep24ConfigError) return res.status(400).json({ error: (error as Error).message, code: 'CONFIG_ERROR' });
      if (error instanceof Sep24AnchorError) return res.status((error as any).statusCode || 502).json({ error: (error as Error).message, code: 'ANCHOR_ERROR' });
      console.error('Error initiating SEP-24 flow:', error);
      res.status(500).json({ error: 'Failed to initiate transaction' });
    }
  });

  // GET /api/anchor/transaction/:transactionId
  router.get('/transaction/:transactionId', async (req: Request, res: Response) => {
    try {
      const { transactionId } = req.params;
      if (!transactionId) return res.status(400).json({ error: 'Invalid transaction ID' });
      const service = await getSep24();
      const transaction = await service.getTransactionStatus(transactionId as string);
      if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
      res.json({
        success: true,
        transaction: {
          transaction_id: transaction.transaction_id,
          anchor_id: transaction.anchor_id,
          direction: transaction.direction,
          status: transaction.status,
          asset_code: transaction.asset_code,
          amount: transaction.amount,
          amount_in: transaction.amount_in,
          amount_out: transaction.amount_out,
          amount_fee: transaction.amount_fee,
          stellar_transaction_id: transaction.stellar_transaction_id,
          external_transaction_id: transaction.external_transaction_id,
          kyc_status: transaction.kyc_status,
          created_at: transaction.created_at,
          updated_at: transaction.updated_at,
        },
      });
    } catch (error) {
      console.error('Error getting transaction status:', error);
      res.status(500).json({ error: 'Failed to get transaction status' });
    }
  });

  return router;
}
