import { Pool } from 'pg';

export interface AuditLogEntry {
  id: number;
  admin_address: string;
  action: string;
  target: string | null;
  params_json: Record<string, unknown> | null;
  tx_hash: string | null;
  created_at: Date;
}

export interface AuditLogFilter {
  admin_address?: string;
  action?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export class AdminAuditLogService {
  constructor(private readonly pool: Pool) {}

  async log(entry: Omit<AuditLogEntry, 'id' | 'created_at'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO admin_audit_log (admin_address, action, target, params_json, tx_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        entry.admin_address,
        entry.action,
        entry.target ?? null,
        entry.params_json ? JSON.stringify(entry.params_json) : null,
        entry.tx_hash ?? null,
      ]
    );
  }

  async query(filter: AuditLogFilter = {}): Promise<{ entries: AuditLogEntry[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.admin_address) {
      params.push(filter.admin_address);
      conditions.push(`admin_address = $${params.length}`);
    }
    if (filter.action) {
      params.push(filter.action);
      conditions.push(`action = $${params.length}`);
    }
    if (filter.from) {
      params.push(filter.from);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (filter.to) {
      params.push(filter.to);
      conditions.push(`created_at <= $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.pool.query(
      `SELECT COUNT(*) FROM admin_audit_log ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const limit = Math.min(filter.limit ?? 50, 200);
    const offset = filter.offset ?? 0;

    const rows = await this.pool.query(
      `SELECT * FROM admin_audit_log ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return { entries: rows.rows as AuditLogEntry[], total };
  }

  async purgeOlderThan(days: number): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM admin_audit_log WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`,
      [days]
    );
    return result.rowCount ?? 0;
  }
}
