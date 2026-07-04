import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { stringify as csvStringify } from 'csv-stringify/sync';

export function createComplianceRouter(pool: Pool): Router {
  const router = Router();

  // ── Helpers ────────────────────────────────────────────────────────────────

  function parseDate(val: unknown): Date | undefined {
    if (!val || typeof val !== 'string') return undefined;
    const d = new Date(val);
    return isNaN(d.getTime()) ? undefined : d;
  }

  function requiredActor(req: Request): string {
    // In production this would come from the validated JWT / API key principal.
    return (req.headers['x-officer-id'] as string) || 'anonymous';
  }

  async function writeAudit(
    actor: string,
    ip: string,
    format: string,
    filters: object,
    rowCount: number,
  ) {
    await pool.query(
      `INSERT INTO compliance_report_audit
         (accessed_by, ip_address, export_format, filters, row_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [actor, ip, format, JSON.stringify(filters), rowCount],
    );
  }

  // ── GET /api/compliance/report ─────────────────────────────────────────────
  // Returns flagged remittances with optional filters.
  // Query params: from, to, status, currency, corridor, format (json|csv)
  router.get('/report', async (req: Request, res: Response): Promise<void> => {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const status = (req.query.status as string) || undefined;
    const currency = (req.query.currency as string) || undefined;
    const corridor = (req.query.corridor as string) || undefined;
    const format = ((req.query.format as string) || 'json').toLowerCase();

    const params: unknown[] = [];
    const conditions: string[] = [];

    if (from) { params.push(from); conditions.push(`fr.flagged_at >= $${params.length}`); }
    if (to)   { params.push(to);   conditions.push(`fr.flagged_at <= $${params.length}`); }
    if (status)   { params.push(status);   conditions.push(`fr.status = $${params.length}`); }
    if (currency) { params.push(currency.toUpperCase()); conditions.push(`fr.currency = $${params.length}`); }
    if (corridor) { params.push(corridor.toUpperCase()); conditions.push(`fr.corridor = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      const result = await pool.query(
        `SELECT
           fr.id,
           fr.transaction_id,
           fr.corridor,
           fr.amount,
           fr.currency,
           fr.status,
           fr.flagged_at,
           fr.reported_at,
           fr.cleared_at,
           fr.notes,
           ct.threshold,
           ct.jurisdiction,
           t.sender_address,
           t.amount_in,
           t.amount_out,
           t.amount_fee,
           t.created_at AS transaction_date
         FROM compliance_flagged_remittances fr
         LEFT JOIN compliance_thresholds ct ON ct.id = fr.threshold_id
         LEFT JOIN transactions t ON t.transaction_id = fr.transaction_id
         ${where}
         ORDER BY fr.flagged_at DESC
         LIMIT 10000`,
        params,
      );

      const rows = result.rows;
      const actor = requiredActor(req);
      const ip = (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress || '';
      const filters = { from, to, status, currency, corridor };
      await writeAudit(actor, ip, format, filters, rows.length);

      if (format === 'csv') {
        const csv = csvStringify(rows, { header: true });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="compliance_report.csv"');
        res.send(csv);
        return;
      }

      res.json({
        total: rows.length,
        filters,
        records: rows,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate compliance report' });
    }
  });

  // ── GET /api/compliance/thresholds ────────────────────────────────────────
  router.get('/thresholds', async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query(
        `SELECT * FROM compliance_thresholds ORDER BY corridor, currency`,
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ error: 'Failed to fetch thresholds' });
    }
  });

  // ── POST /api/compliance/thresholds ───────────────────────────────────────
  router.post('/thresholds', async (req: Request, res: Response): Promise<void> => {
    const { corridor, currency, threshold, jurisdiction } = req.body;
    if (!corridor || !currency || threshold == null) {
      res.status(400).json({ error: 'corridor, currency, and threshold are required' });
      return;
    }
    try {
      const result = await pool.query(
        `INSERT INTO compliance_thresholds (corridor, currency, threshold, jurisdiction)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (corridor, currency) DO UPDATE
           SET threshold = EXCLUDED.threshold,
               jurisdiction = EXCLUDED.jurisdiction,
               updated_at = NOW()
         RETURNING *`,
        [corridor.toUpperCase(), currency.toUpperCase(), threshold, jurisdiction ?? null],
      );
      res.status(201).json(result.rows[0]);
    } catch {
      res.status(500).json({ error: 'Failed to upsert threshold' });
    }
  });

  // ── POST /api/compliance/flag ──────────────────────────────────────────────
  // Manually flag a remittance (also called automatically on remittance creation).
  router.post('/flag', async (req: Request, res: Response): Promise<void> => {
    const { transaction_id, amount, currency, corridor, notes } = req.body;
    if (!transaction_id || amount == null || !currency) {
      res.status(400).json({ error: 'transaction_id, amount, and currency are required' });
      return;
    }
    try {
      const thresholdResult = await pool.query(
        `SELECT id FROM compliance_thresholds
         WHERE currency = $1 AND threshold <= $2 AND active = TRUE
         ORDER BY threshold DESC LIMIT 1`,
        [currency.toUpperCase(), amount],
      );
      const thresholdId = thresholdResult.rows[0]?.id ?? null;

      const result = await pool.query(
        `INSERT INTO compliance_flagged_remittances
           (transaction_id, corridor, amount, currency, threshold_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (transaction_id) DO NOTHING
         RETURNING *`,
        [transaction_id, corridor?.toUpperCase() ?? null, amount, currency.toUpperCase(), thresholdId, notes ?? null],
      );
      res.status(201).json(result.rows[0] ?? { message: 'already flagged' });
    } catch {
      res.status(500).json({ error: 'Failed to flag remittance' });
    }
  });

  // ── PATCH /api/compliance/flag/:id ────────────────────────────────────────
  // Update status: reported | cleared
  router.patch('/flag/:id', async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { status, notes } = req.body;
    if (!['reported', 'cleared', 'pending'].includes(status)) {
      res.status(400).json({ error: 'status must be reported | cleared | pending' });
      return;
    }
    try {
      const result = await pool.query(
        `UPDATE compliance_flagged_remittances
         SET status = $1,
             reported_at = CASE WHEN $1 = 'reported' THEN NOW() ELSE reported_at END,
             cleared_at  = CASE WHEN $1 = 'cleared'  THEN NOW() ELSE cleared_at  END,
             notes = COALESCE($2, notes)
         WHERE id = $3
         RETURNING *`,
        [status, notes ?? null, id],
      );
      if (!result.rows.length) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ error: 'Failed to update flag status' });
    }
  });

  return router;
}

// ── Auto-flag helper (called from remittance creation path) ─────────────────
export async function autoFlagIfAboveThreshold(
  pool: Pool,
  transactionId: string,
  amount: number,
  currency: string,
  corridor?: string,
): Promise<void> {
  const thresholdResult = await pool.query(
    `SELECT id FROM compliance_thresholds
     WHERE currency = $1 AND threshold <= $2 AND active = TRUE
     LIMIT 1`,
    [currency.toUpperCase(), amount],
  );
  if (!thresholdResult.rows.length) return;

  const thresholdId = thresholdResult.rows[0].id;
  await pool.query(
    `INSERT INTO compliance_flagged_remittances
       (transaction_id, corridor, amount, currency, threshold_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (transaction_id) DO NOTHING`,
    [transactionId, corridor?.toUpperCase() ?? null, amount, currency.toUpperCase(), thresholdId],
  );
}
