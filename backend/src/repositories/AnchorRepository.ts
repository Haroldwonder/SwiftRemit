import { Pool } from 'pg';
import { Sep24TransactionDbRecord } from '../database';

export class AnchorRepository {
  constructor(private readonly pool: Pool) {}

  async save(record: Omit<Sep24TransactionDbRecord, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO sep24_transactions
         (transaction_id, anchor_id, direction, status, asset_code,
          amount, amount_in, amount_out, amount_fee,
          stellar_transaction_id, external_transaction_id,
          user_id, interactive_url, instructions_url,
          kyc_status, kyc_web_url, status_eta, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (transaction_id) DO UPDATE SET
         status                  = EXCLUDED.status,
         amount_in               = COALESCE(EXCLUDED.amount_in, sep24_transactions.amount_in),
         amount_out              = COALESCE(EXCLUDED.amount_out, sep24_transactions.amount_out),
         amount_fee              = COALESCE(EXCLUDED.amount_fee, sep24_transactions.amount_fee),
         stellar_transaction_id  = COALESCE(EXCLUDED.stellar_transaction_id, sep24_transactions.stellar_transaction_id),
         external_transaction_id = COALESCE(EXCLUDED.external_transaction_id, sep24_transactions.external_transaction_id),
         kyc_status              = COALESCE(EXCLUDED.kyc_status, sep24_transactions.kyc_status),
         message                 = COALESCE(EXCLUDED.message, sep24_transactions.message),
         updated_at              = NOW()`,
      [
        record.transaction_id, record.anchor_id, record.direction, record.status, record.asset_code,
        record.amount ?? null, record.amount_in ?? null, record.amount_out ?? null, record.amount_fee ?? null,
        record.stellar_transaction_id ?? null, record.external_transaction_id ?? null,
        record.user_id, record.interactive_url ?? null, record.instructions_url ?? null,
        record.kyc_status ?? null, record.kyc_web_url ?? null, record.status_eta ?? null, record.message ?? null,
      ]
    );
  }

  async findById(transactionId: string): Promise<Sep24TransactionDbRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM sep24_transactions WHERE transaction_id = $1`,
      [transactionId]
    );
    return (result.rows[0] as Sep24TransactionDbRecord) ?? null;
  }

  async findByUser(userId: string): Promise<Sep24TransactionDbRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM sep24_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [userId]
    );
    return result.rows as Sep24TransactionDbRecord[];
  }

  async findPending(anchorId: string, minutesSinceLastPoll: number): Promise<Sep24TransactionDbRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM sep24_transactions
       WHERE anchor_id = $1
         AND status NOT IN ('completed', 'refunded', 'expired', 'error')
         AND (last_polled IS NULL OR last_polled < NOW() - ($2 || ' minutes')::INTERVAL)
       ORDER BY created_at ASC
       LIMIT 50`,
      [anchorId, minutesSinceLastPoll]
    );
    return result.rows as Sep24TransactionDbRecord[];
  }

  async updateStatus(
    transactionId: string,
    status: string,
    fields: {
      amountIn?: string; amountOut?: string; amountFee?: string;
      stellarTransactionId?: string; externalTransactionId?: string; message?: string;
    } = {}
  ): Promise<void> {
    await this.pool.query(
      `UPDATE sep24_transactions SET
         status                  = $2,
         amount_in               = COALESCE($3, amount_in),
         amount_out              = COALESCE($4, amount_out),
         amount_fee              = COALESCE($5, amount_fee),
         stellar_transaction_id  = COALESCE($6, stellar_transaction_id),
         external_transaction_id = COALESCE($7, external_transaction_id),
         message                 = COALESCE($8, message),
         last_polled             = NOW(),
         updated_at              = NOW()
       WHERE transaction_id = $1`,
      [
        transactionId, status,
        fields.amountIn ?? null, fields.amountOut ?? null, fields.amountFee ?? null,
        fields.stellarTransactionId ?? null, fields.externalTransactionId ?? null, fields.message ?? null,
      ]
    );
  }
}
