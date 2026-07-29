import { Pool } from 'pg';
import { AdminAuditLogRepository } from './repositories/AdminAuditLogRepository';

export interface AuditLogEntry {
  id: number;
  admin_address: string;
  action: string;
  target: string | null;
  params_json: Record<string, unknown> | null;
  tx_hash: string | null;
  ip_address: string | null;
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
  private repo: AdminAuditLogRepository;

  constructor(pool: Pool) {
    this.repo = new AdminAuditLogRepository(pool);
  }

  async log(entry: Omit<AuditLogEntry, 'id' | 'created_at'>): Promise<void> {
    await this.repo.insert(entry);
  }

  async query(filter: AuditLogFilter = {}): Promise<{ entries: AuditLogEntry[]; total: number }> {
    return this.repo.query(filter);
  }

  async purgeOlderThan(days: number): Promise<number> {
    return this.repo.purgeOlderThan(days);
  }
}
