import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { getWebhookSubscriberById, rotateWebhookSecret } from '../database';
import { AdminAuditLogService } from '../admin-audit-log';
import { getJobSummaries } from '../job-tracker';
import { createLogger } from '../correlation-id';
import { validateQuery } from '../middleware/validate';
import {
  AuditLogExportQuerySchema,
  AUDIT_LOG_EXPORT_MAX_DAYS,
  AUDIT_LOG_EXPORT_ROW_CAP,
} from '../schemas/zod';

const logger = createLogger('routes/admin');

/**
 * Resolve the authenticated principal for audit attribution. Prefers the
 * verified API-key owner (attached by scopedApiKeyMiddleware in api.ts,
 * which now gates every /api/admin route on the admin:* scope) over the
 * client-supplied x-user-id header, which any caller can forge.
 */
function resolveActor(req: Request): string {
  const apiKey = (req as any).apiKey as { owner_id?: string } | undefined;
  if (apiKey?.owner_id) return apiKey.owner_id;
  return (req.headers['x-user-id'] as string) || 'unknown';
}

export function createAdminRouter(pool: Pool): Router {
  const router = Router();

  async function logAdminAction(
    req: Request,
    action: string,
    target: string | null = null,
    params: Record<string, unknown> | null = null,
  ): Promise<void> {
    const auditService = new AdminAuditLogService(pool);
    await auditService.log({
      admin_address: resolveActor(req),
      action,
      target,
      params_json: params,
      tx_hash: null,
      ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? null,
    });
  }

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
        admin_address: resolveActor(req),
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

  // GET /api/admin/audit-log — keyset (cursor) pagination
  router.get('/audit-log', async (req: Request, res: Response) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = Math.min(Number(q.limit) || 50, 200);

      // Decode opaque cursor (base64-encoded JSON {id, created_at})
      let cursorCondition = '';
      const params: unknown[] = [];
      let idx = 1;

      if (q.admin_address) { params.push(q.admin_address); cursorCondition += ` AND admin_address = $${idx++}`; }
      if (q.action)        { params.push(q.action);        cursorCondition += ` AND action = $${idx++}`; }
      if (q.from)          { params.push(new Date(q.from)); cursorCondition += ` AND created_at >= $${idx++}`; }
      if (q.to)            { params.push(new Date(q.to));   cursorCondition += ` AND created_at <= $${idx++}`; }

      if (q.cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(q.cursor, 'base64').toString('utf8'));
          if (decoded === null || typeof decoded !== 'object' || decoded.id === undefined) {
            throw new Error('Malformed cursor payload');
          }
          params.push(decoded.created_at);
          params.push(decoded.id);
          cursorCondition += ` AND (created_at < $${idx} OR (created_at = $${idx} AND id < $${idx + 1}))`;
          idx += 2;
        } catch {
          return res.status(400).json({ error: 'Invalid cursor' });
        }
      }

      const where = cursorCondition ? `WHERE 1=1 ${cursorCondition}` : '';
      params.push(limit + 1); // fetch one extra to detect next page
      const rows = await pool.query(
        `SELECT * FROM admin_audit_log ${where} ORDER BY created_at DESC, id DESC LIMIT $${idx}`,
        params,
      );

      const hasMore = rows.rows.length > limit;
      const entries = hasMore ? rows.rows.slice(0, limit) : rows.rows;

      let nextCursor: string | null = null;
      if (hasMore) {
        const last = entries[entries.length - 1];
        nextCursor = Buffer.from(JSON.stringify({ id: last.id, created_at: last.created_at })).toString('base64');
      }

      await logAdminAction(req, 'list_admin_audit_log', null, {
        action: q.action ?? null,
        admin_address: q.admin_address ?? null,
        limit,
        cursor: Boolean(q.cursor),
      });

      return res.json({ limit, cursor: q.cursor ?? null, next_cursor: nextCursor, entries });
    } catch (error) {
      logger.error('Error fetching audit log', error instanceof Error ? error : new Error(String(error)));
      return res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  });

  // GET /api/admin/audit-log/export
  // Mandatory date range (≤ AUDIT_LOG_EXPORT_MAX_DAYS), hard row cap and
  // server-side cursor streaming so a large export never buffers in memory.
  router.get('/audit-log/export', validateQuery(AuditLogExportQuerySchema), async (req: Request, res: Response) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const from = new Date(q.from as string);
      const to   = new Date(q.to   as string);
      const adminAddress = q.admin_address;
      const action       = q.action;

      // Build parameterised WHERE clause
      const baseParams: unknown[] = [from, to];
      let extraWhere = '';
      if (adminAddress) { baseParams.push(adminAddress); extraWhere += ` AND admin_address = $${baseParams.length}`; }
      if (action)       { baseParams.push(action);       extraWhere += ` AND action = $${baseParams.length}`; }

      const baseWhere = `WHERE created_at >= $1 AND created_at <= $2${extraWhere}`;

      await logAdminAction(req, 'export_admin_audit_log', null, {
        from: q.from ?? null,
        to: q.to ?? null,
        admin_address: adminAddress ?? null,
        action: action ?? null,
      });

      // Check row count before streaming — hard cap at AUDIT_LOG_EXPORT_ROW_CAP
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM admin_audit_log ${baseWhere}`,
        baseParams,
      );
      const total = parseInt(countRes.rows[0].count, 10);
      if (total > AUDIT_LOG_EXPORT_ROW_CAP) {
        return res.status(413).json({
          error: `Export exceeds the ${AUDIT_LOG_EXPORT_ROW_CAP.toLocaleString()} row cap (${total.toLocaleString()} rows matched). Narrow the date range or add filters.`,
          matched: total,
          cap: AUDIT_LOG_EXPORT_ROW_CAP,
          max_date_range_days: AUDIT_LOG_EXPORT_MAX_DAYS,
        });
      }

      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-log.ndjson"');
      res.setHeader('X-Total-Rows', String(total));

      // Stream via server-side cursor — never buffers the full result set
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `DECLARE audit_export_cursor NO SCROLL CURSOR FOR
             SELECT * FROM admin_audit_log ${baseWhere} ORDER BY created_at ASC, id ASC`,
          baseParams,
        );

        const PAGE = 500;
        let done = false;
        while (!done) {
          const batch = await client.query(`FETCH ${PAGE} FROM audit_export_cursor`);
          if (batch.rows.length === 0) break;
          for (const row of batch.rows) {
            res.write(JSON.stringify(row) + '\n');
          }
          if (batch.rows.length < PAGE) done = true;
        }

        await client.query('CLOSE audit_export_cursor');
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return res.end();
    } catch (error) {
      logger.error('Error exporting audit log', error instanceof Error ? error : new Error(String(error)));
      if (!res.headersSent) return res.status(500).json({ error: 'Failed to export audit log' });
      return res.end();
    }
  });

  // GET /api/admin/jobs
  router.get('/jobs', async (req: Request, res: Response) => {
    try {
      const summaries = await getJobSummaries(pool);
      await logAdminAction(req, 'view_admin_jobs', null, { job_count: summaries.length });
      res.json({ jobs: summaries });
    } catch (error) {
      logger.error('Error fetching job summaries', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: 'Failed to fetch job summaries' });
    }
  });

  return router;
}
