import { Pool } from 'pg';

export type HighRiskOperation = 'withdraw_fees' | 'remove_agent' | 'update_fee';

export interface PendingAdminAction {
  id: string;
  operation: HighRiskOperation;
  initiated_by: string;
  params: Record<string, unknown>;
  expires_at: Date;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  created_at: Date;
}

export class AdminConfirmationService {
  constructor(private pool: Pool) {}

  async initTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS pending_admin_actions (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        operation     VARCHAR(50)  NOT NULL,
        initiated_by  VARCHAR(56)  NOT NULL,
        params        JSONB        NOT NULL DEFAULT '{}',
        expires_at    TIMESTAMP    NOT NULL,
        confirmed_by  VARCHAR(56),
        confirmed_at  TIMESTAMP,
        created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_paa_expires ON pending_admin_actions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_paa_operation ON pending_admin_actions(operation);
    `);
  }

  async initiate(
    operation: HighRiskOperation,
    initiatedBy: string,
    params: Record<string, unknown>
  ): Promise<PendingAdminAction> {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const result = await this.pool.query<PendingAdminAction>(
      `INSERT INTO pending_admin_actions (operation, initiated_by, params, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [operation, initiatedBy, JSON.stringify(params), expiresAt]
    );
    return result.rows[0];
  }

  async confirm(actionId: string, confirmingAdmin: string): Promise<PendingAdminAction> {
    const existing = await this.get(actionId);
    if (!existing) throw new Error(`Pending action not found: ${actionId}`);
    if (existing.confirmed_by) throw new Error('Action already confirmed');
    if (new Date() > existing.expires_at) throw new Error('Pending action has expired');
    if (existing.initiated_by === confirmingAdmin)
      throw new Error('The initiating admin cannot confirm their own action');

    const result = await this.pool.query<PendingAdminAction>(
      `UPDATE pending_admin_actions SET confirmed_by = $1, confirmed_at = NOW()
       WHERE id = $2 RETURNING *`,
      [confirmingAdmin, actionId]
    );
    return result.rows[0];
  }

  async get(id: string): Promise<PendingAdminAction | null> {
    const result = await this.pool.query<PendingAdminAction>(
      `SELECT * FROM pending_admin_actions WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async listPending(): Promise<PendingAdminAction[]> {
    const result = await this.pool.query<PendingAdminAction>(
      `SELECT * FROM pending_admin_actions
       WHERE confirmed_by IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC`
    );
    return result.rows;
  }

  /**
   * Verify a confirmation token (action ID). Returns the action if it is
   * confirmed and not expired, or null if invalid/expired/unconfirmed.
   */
  async verify(token: string): Promise<PendingAdminAction | null> {
    const action = await this.get(token);
    if (!action) return null;
    if (!action.confirmed_by) return null;
    if (new Date() > action.expires_at) return null;
    return action;
  }
}
