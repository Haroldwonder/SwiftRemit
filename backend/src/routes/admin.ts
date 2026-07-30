import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { getWebhookSubscriberById, rotateWebhookSecret } from '../database';
import { AdminAuditLogService } from '../admin-audit-log';
import { getJobSummaries } from '../job-tracker';
import { createLogger } from '../correlation-id';

const logger = createLogger('routes/admin');

export function createAdminRouter(pool: Pool): Router {
  const router = Router();

  // POST /api/webhooks/:id/rotate-secret
  router.post('/webhooks/:id/rotate-secret', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({ error: 'Invalid subscriber ID' });
    }
    try {
      const { newSecret, rotatedAt } = await rotateWebhookSecret(id);
      const subscriber = await getWebhookSubscriberById(id);
      const auditService = new AdminAuditLogService(pool);
      await auditService.log({
        admin_address: (req.headers['x-user-id'] as string) || 'unknown',
        action: 'rotate_webhook_secret',
        target: id,
        params_json: null,
        tx_hash: null,
        ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? null,
      });
      if (subscriber?.url) {
        try {
          const timestamp = Date.now().toString();
          const notificationBody = JSON.stringify({
            event: 'webhook.secret_rotated',
            subscriber_id: id,
            new_secret: newSecret,
            rotated_at: rotatedAt.toISOString(),
            grace_period_hours: 24,
          });
          const signature = crypto.createHmac('sha256', newSecret).update(`${timestamp}.${notificationBody}`).digest('hex');
          await fetch(subscriber.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-event-type': 'webhook.secret_rotated', 'x-webhook-timestamp': timestamp, 'x-webhook-signature': signature },
            body: notificationBody,
          });
        } catch (notifyErr) {
          logger.warn('Failed to notify subscriber of secret rotation', { id, error: notifyErr });
        }
      }
      return res.status(200).json({
        subscriber_id: id,
        secret_rotated_at: rotatedAt.toISOString(),
        grace_period_hours: 24,
        message: 'Secret rotated. Previous secret accepted for 24 hours.',
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Webhook subscriber not found')) {
        return res.status(404).json({ error: 'Webhook subscriber not found' });
      }
      logger.error('Failed to rotate webhook secret', error instanceof Error ? error : new Error(String(error)));
      return res.status(500).json({ error: 'Failed to rotate webhook secret' });
    }
  });

  // GET /api/admin/audit-log
  router.get('/audit-log', async (req: Request, res: Response) => {
    try {
      const auditService = new AdminAuditLogService(pool);
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const filter = {
        admin_address: req.query.admin_address as string | undefined,
        action: req.query.action as string | undefined,
        from: req.query.from ? new Date(req.query.from as string) : undefined,
        to: req.query.to ? new Date(req.query.to as string) : undefined,
        limit,
        offset,
      };
      const { entries, total } = await auditService.query(filter);
      res.json({ total, limit, offset, entries });
    } catch (error) {
      logger.error('Error fetching audit log', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  });

  // GET /api/admin/audit-log/export
  router.get('/audit-log/export', async (req: Request, res: Response) => {
    try {
      const auditService = new AdminAuditLogService(pool);
      const filter = {
        admin_address: req.query.admin_address as string | undefined,
        action: req.query.action as string | undefined,
        from: req.query.from ? new Date(req.query.from as string) : undefined,
        to: req.query.to ? new Date(req.query.to as string) : undefined,
        limit: 200,
        offset: 0,
      };
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-log.ndjson"');
      let offset = 0;
      while (true) {
        filter.offset = offset;
        const { entries } = await auditService.query(filter);
        if (entries.length === 0) break;
        for (const entry of entries) res.write(JSON.stringify(entry) + '\n');
        if (entries.length < filter.limit) break;
        offset += filter.limit;
      }
      res.end();
    } catch (error) {
      logger.error('Error exporting audit log', error instanceof Error ? error : new Error(String(error)));
      if (!res.headersSent) res.status(500).json({ error: 'Failed to export audit log' });
    }
  });

  // GET /api/admin/jobs
  router.get('/jobs', async (_req: Request, res: Response) => {
    try {
      const summaries = await getJobSummaries(pool);
      res.json({ jobs: summaries });
    } catch (error) {
      logger.error('Error fetching job summaries', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to fetch job summaries' });
    }
  });

  return router;
}
