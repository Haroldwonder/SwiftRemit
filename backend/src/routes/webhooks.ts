import { Router } from 'express';
import { handleKycWebhook } from '../kyc-webhook-handler';

/**
 * Inbound webhook receiver routes.
 * Rate limiting is applied at mount point in api.ts.
 */
export function createWebhooksRouter(): Router {
  const router = Router();

  // POST /webhooks/kyc/:anchor_id
  router.post('/kyc/:anchor_id', handleKycWebhook);

  return router;
}
