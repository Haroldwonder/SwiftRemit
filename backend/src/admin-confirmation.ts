/**
 * Multi-step Admin Confirmation (#481)
 *
 * High-risk operations (withdraw_fees, remove_agent, update_fee) require
 * a second admin to confirm before execution. Pending actions expire after 1 hour.
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { AdminAuditLogService } from './admin-audit-log';

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

const EXPIRY_HOURS = 1;

export class AdminConfirmationService {
  private auditLog: AdminAuditLogService;

  constructor(private pool: Pool) {
    this.auditLog = new AdminAuditLogService(pool);
  }

  /** Create the pending_admin_actions table if it doesn't exist. */
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

  /**
   * Initiate a high-risk operation. Returns the pending action ID.
   * The initiating admin cannot also confirm.
   */
  async initiate(
    operation: HighRiskOperation,
    initiatedBy: string,
    params: Record<string, unknown>
  ): Promise<PendingAdminAction> {
    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);

    const result = await this.pool.query<PendingAdminAction>(
      `INSERT INTO pending_admin_actions (operation, initiated_by, params, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [operation, initiatedBy, JSON.stringify(params), expiresAt]
    );

    const action = result.rows[0];

    await this.auditLog.log({
      admin_address: initiatedBy,
      action: `${operation}.initiated`,
      target: action.id,
      params_json: params,
      tx_hash: null,
    });

    return action;
  }

  /**
   * Confirm a pending action. The confirming admin must differ from the initiator.
   * Returns the confirmed action on success, throws on failure.
   */
  async confirm(
    actionId: string,
    confirmingAdmin: string
  ): Promise<PendingAdminAction> {
    const existing = await this.get(actionId);

    if (!existing) {
      throw new Error(`Pending action not found: ${actionId}`);
    }
    if (existing.confirmed_by) {
      throw new Error('Action already confirmed');
    }
    if (new Date() > existing.expires_at) {
      throw new Error('Pending action has expired');
    }
    if (existing.initiated_by === confirmingAdmin) {
      throw new Error('The initiating admin cannot confirm their own action');
    }

    const result = await this.pool.query<PendingAdminAction>(
      `UPDATE pending_admin_actions
       SET confirmed_by = $1, confirmed_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [confirmingAdmin, actionId]
    );

    const action = result.rows[0];

    await this.auditLog.log({
      admin_address: confirmingAdmin,
      action: `${existing.operation}.confirmed`,
      target: actionId,
      params_json: existing.params,
      tx_hash: null,
    });

    return action;
  }

  /** Fetch a single pending action by ID. */
  async get(id: string): Promise<PendingAdminAction | null> {
    const result = await this.pool.query<PendingAdminAction>(
      `SELECT * FROM pending_admin_actions WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  /** List all pending (unconfirmed, non-expired) actions. */
  async listPending(): Promise<PendingAdminAction[]> {
    const result = await this.pool.query<PendingAdminAction>(
      `SELECT * FROM pending_admin_actions
       WHERE confirmed_by IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC`
    );
    return result.rows;
  }

  /** Delete expired unconfirmed actions (housekeeping). */
  async purgeExpired(): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM pending_admin_actions
       WHERE confirmed_by IS NULL AND expires_at <= NOW()`
    );
    return result.rowCount ?? 0;
  }
}
