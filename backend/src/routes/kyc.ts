import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { saveAnchorKycConfig, getUserKycStatus } from '../database';
import { AnchorKycConfig } from '../types';
import { KycUpsertService } from '../kyc-upsert-service';
import { createTransferGuard, AuthenticatedRequest } from '../transfer-guard';
import { AdminAuditLogService } from '../admin-audit-log';
import { sanitizeInput } from '../sanitizer';

function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = (req.headers['x-user-id'] as string) || '';
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  req.user = { id: userId };
  next();
}

export function createKycRouter(pool: Pool): Router {
  const router = Router();
  const kycUpsertService = new KycUpsertService(pool);
  const transferGuard = createTransferGuard(kycUpsertService);

  // GET /api/kyc/status  (authenticated user's own status)
  router.get('/status', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const status = await kycUpsertService.getStatusForUser(userId);
      return res.status(200).json(status);
    } catch (error) {
      console.error('Error fetching KYC status:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/kyc/status/:userId/:anchorId
  router.get('/status/:userId/:anchorId', async (req: Request, res: Response) => {
    try {
      const { userId, anchorId } = req.params;
      if (!userId || !anchorId) return res.status(400).json({ error: 'Invalid user ID or anchor ID' });
      const kycStatus = await getUserKycStatus(userId, anchorId);
      if (!kycStatus) return res.status(404).json({ error: 'KYC status not found' });
      res.json(kycStatus);
    } catch (error) {
      console.error('Error fetching KYC status:', error);
      res.status(500).json({ error: 'Failed to fetch KYC status' });
    }
  });

  // GET /api/kyc/approved/:userId
  router.get('/approved/:userId', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      if (!userId) return res.status(400).json({ error: 'Invalid user ID' });
      const { KycService } = await import('../kyc-service');
      const service = new KycService();
      const isApproved = await service.isUserKycApproved(userId);
      res.json({ userId, kycApproved: isApproved });
    } catch (error) {
      console.error('Error checking KYC approval:', error);
      res.status(500).json({ error: 'Failed to check KYC approval' });
    }
  });

  // POST /api/kyc/config  (admin — rate-limited at mount point)
  router.post('/config', async (req: Request, res: Response) => {
    try {
      const { anchorId, kycServerUrl, authToken, pollingIntervalMinutes, enabled } = req.body;
      if (!anchorId || !kycServerUrl || !authToken) {
        return res.status(400).json({ error: 'Missing required fields: anchorId, kycServerUrl, authToken' });
      }
      const config: AnchorKycConfig = {
        anchor_id: sanitizeInput(anchorId),
        kyc_server_url: sanitizeInput(kycServerUrl),
        auth_token: authToken,
        polling_interval_minutes: pollingIntervalMinutes || 60,
        enabled: enabled !== false,
      };
      await saveAnchorKycConfig(config);
      const auditService = new AdminAuditLogService(pool);
      await auditService.log({
        admin_address: (req.headers['x-user-id'] as string) || 'unknown',
        action: 'configure_kyc',
        target: anchorId,
        params_json: { kycServerUrl, pollingIntervalMinutes, enabled },
        tx_hash: null,
        ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? null,
      });
      res.json({ success: true, message: 'Anchor KYC config saved successfully' });
    } catch (error) {
      console.error('Error saving anchor KYC config:', error);
      res.status(500).json({ error: 'Failed to save anchor KYC config' });
    }
  });

  // POST /api/kyc/register
  router.post('/register', async (req: Request, res: Response) => {
    try {
      const { userId, anchorId } = req.body;
      if (!userId || !anchorId) return res.status(400).json({ error: 'Missing required fields: userId, anchorId' });
      const sanitizedUserId = sanitizeInput(userId);
      const sanitizedAnchorId = sanitizeInput(anchorId);
      const { KycService } = await import('../kyc-service');
      const service = new KycService();
      await service.registerUserForKyc(sanitizedUserId, sanitizedAnchorId);
      const auditService = new AdminAuditLogService(pool);
      await auditService.log({
        admin_address: (req.headers['x-user-id'] as string) || 'unknown',
        action: 'register_kyc_user',
        target: sanitizedUserId,
        params_json: { anchorId: sanitizedAnchorId },
        tx_hash: null,
        ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? null,
      });
      res.json({ success: true, message: 'User registered for KYC successfully' });
    } catch (error) {
      console.error('Error registering user for KYC:', error);
      res.status(500).json({ error: 'Failed to register user for KYC' });
    }
  });

  // POST /api/transfer  (guarded by KYC + auth)
  router.post('/transfer', authMiddleware, transferGuard, async (_req: Request, res: Response) => {
    return res.status(200).json({ success: true, message: 'Transfer allowed' });
  });

  return router;
}
