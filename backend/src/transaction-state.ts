import { Pool } from 'pg';
import { getCorrelationId } from './correlation-id';
import { MetricsService } from './metrics';

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
  private metricsService: MetricsService;

  constructor(private pool: Pool) {
    this.metricsService = new MetricsService(pool);
  }

  /**
   * Get correlation ID for logging
   */
  private getLogContext(): { correlation_id?: string } {
    const correlationId = getCorrelationId();
    return correlationId ? { correlation_id: correlationId } : {};
  }

  /**
   * Update transaction state from webhook
   */
  async updateTransactionState(
    update: TransactionUpdate,
    kind: TransactionKind
  ): Promise<void> {
    const logContext = this.getLogContext();
    console.log('Updating transaction state', { 
      transaction_id: update.transaction_id,
      status: update.status,
      kind,
      ...logContext 
    });

    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

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
         (transaction_id, from_status, to_status, changed_at, correlation_id)
         SELECT transaction_id, status, $1, NOW(), $2
         FROM transactions 
         WHERE transaction_id = $3`,
        [update.status, logContext.correlation_id, update.transaction_id]
      );

      console.log('Transaction state updated successfully', { 
        transaction_id: update.transaction_id,
        status: update.status,
        kind,
        ...logContext 
      });

      // Track settlement metrics
      this.metricsService.incrementSettlements(update.status, kind);

      await client.query('COMMIT');
    } catch (error) {
      console.error('Error updating transaction state:', error, { 
        transaction_id: update.transaction_id,
        status: update.status,
        kind,
        ...logContext 
      });
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
    const logContext = this.getLogContext();
    console.log('Updating KYC status', { 
      transaction_id: update.transaction_id,
      kyc_status: update.kyc_status,
      ...logContext 
    });

    try {
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

      console.log('KYC status updated successfully', { 
        transaction_id: update.transaction_id,
        kyc_status: update.kyc_status,
        ...logContext 
      });
    } catch (error) {
      console.error('Error updating KYC status:', error, { 
        transaction_id: update.transaction_id,
        kyc_status: update.kyc_status,
        ...logContext 
      });
      throw error;
    }
  }

  /**
   * Validate state transition
   */
  validateTransition(
    currentStatus: TransactionStatus,
    newStatus: TransactionStatus,
    kind: TransactionKind
  ): boolean {
    const logContext = this.getLogContext();
    
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
    const isValid = allowedTransitions.includes(newStatus);
    
    if (!isValid) {
      console.log('Invalid state transition detected', { 
        currentStatus, 
        newStatus, 
        kind, 
        allowedTransitions,
        ...logContext 
      });
    } else {
      console.log('Valid state transition', { 
        currentStatus, 
        newStatus, 
        kind,
        ...logContext 
      });
    }

    return isValid;
  }
}
