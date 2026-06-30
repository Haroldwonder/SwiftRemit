import { Pool } from 'pg';

export type TransactionStatus = 
  | 'pending_user_transfer_start'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_external'
  | 'pending_trust'
  | 'pending_user'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'error';

export type TransactionKind = 'deposit' | 'withdrawal';

export interface TransactionUpdate {
  transaction_id: string;
  status: TransactionStatus;
  status_eta?: number;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  message?: string;
  refunds?: any;
}

export interface KYCUpdate {
  transaction_id: string;
  kyc_status: 'pending' | 'approved' | 'rejected';
  kyc_fields?: Record<string, any>;
  rejection_reason?: string;
}

export class TransactionStateManager {
  constructor(private pool: Pool) {}

  /**
   * Update transaction state from webhook
   */
  async updateTransactionState(
    update: TransactionUpdate,
    kind: TransactionKind
  ): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Fetch the current status and lock the row to prevent concurrent updates
      const current = await client.query<{ status: TransactionStatus }>(
        'SELECT status FROM transactions WHERE transaction_id = $1 AND kind = $2 FOR UPDATE',
        [update.transaction_id, kind]
      );

      if (current.rows.length === 0) {
        throw new Error(`Transaction ${update.transaction_id} not found`);
      }

      const currentStatus = current.rows[0].status;
      if (!this.validateTransition(currentStatus, update.status, kind)) {
        throw new Error(
          `Invalid state transition: '${currentStatus}' → '${update.status}' ` +
          `for ${kind} transaction ${update.transaction_id}`
        );
      }

      // Update transaction record
      await client.query(
        `UPDATE transactions 
         SET status = $1, 
             status_eta = $2,
             amount_in = COALESCE($3, amount_in),
             amount_out = COALESCE($4, amount_out),
             amount_fee = COALESCE($5, amount_fee),
             stellar_transaction_id = COALESCE($6, stellar_transaction_id),
             external_transaction_id = COALESCE($7, external_transaction_id),
             message = COALESCE($8, message),
             updated_at = NOW()
         WHERE transaction_id = $9 AND kind = $10`,
        [
          update.status,
          update.status_eta,
          update.amount_in,
          update.amount_out,
          update.amount_fee,
          update.stellar_transaction_id,
          update.external_transaction_id,
          update.message,
          update.transaction_id,
          kind
        ]
      );

      // Log state transition
      await client.query(
        `INSERT INTO transaction_state_history 
         (transaction_id, from_status, to_status, changed_at)
         SELECT transaction_id, status, $1, NOW()
         FROM transactions 
         WHERE transaction_id = $2`,
        [update.status, update.transaction_id]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update KYC status
   */
  async updateKYCStatus(update: KYCUpdate): Promise<void> {
    await this.pool.query(
      `UPDATE transactions 
       SET kyc_status = $1,
           kyc_fields = COALESCE($2, kyc_fields),
           kyc_rejection_reason = $3,
           updated_at = NOW()
       WHERE transaction_id = $4`,
      [
        update.kyc_status,
        update.kyc_fields ? JSON.stringify(update.kyc_fields) : null,
        update.rejection_reason,
        update.transaction_id
      ]
    );
  }

  /**
   * Validate state transition
   */
  validateTransition(
    currentStatus: TransactionStatus,
    newStatus: TransactionStatus,
    kind: TransactionKind
  ): boolean {
    const validTransitions: Record<TransactionKind, Record<TransactionStatus, TransactionStatus[]>> = {
      deposit: {
        'pending_user_transfer_start': ['pending_anchor', 'expired', 'error'],
        'pending_anchor': ['pending_stellar', 'pending_trust', 'pending_user', 'error'],
        'pending_stellar': ['completed', 'error'],
        'pending_trust': ['pending_user', 'error'],
        'pending_user': ['completed', 'error'],
        'pending_external': ['completed', 'error'],
        'completed': [],
        'refunded': [],
        'expired': [],
        'error': ['refunded']
      },
      withdrawal: {
        'pending_user_transfer_start': ['pending_anchor', 'expired', 'error'],
        'pending_anchor': ['pending_external', 'pending_stellar', 'error'],
        'pending_external': ['completed', 'error'],
        'pending_stellar': ['completed', 'error'],
        'pending_trust': [],
        'pending_user': [],
        'completed': [],
        'refunded': [],
        'expired': [],
        'error': ['refunded']
      }
    };

    const allowedTransitions = validTransitions[kind][currentStatus] || [];
    return allowedTransitions.includes(newStatus);
  }
}
