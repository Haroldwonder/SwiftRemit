import { Pool } from 'pg';

export interface TransactionRecord {
  id?: string;
  transaction_id: string;
  anchor_id?: string;
  kind?: 'deposit' | 'withdrawal';
  status?: string;
  status_eta?: number;
  amount_in?: number;
  amount_out?: number;
  amount_fee?: number;
  asset_code?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  kyc_status?: string;
  kyc_fields?: Record<string, unknown>;
  kyc_rejection_reason?: string;
  message?: string;
  memo?: string;
  sender_address?: string;
  created_at?: Date;
  updated_at?: Date;
}

export class RemittanceRepository {
  constructor(private readonly pool: Pool) {}

  async findById(transactionId: string): Promise<TransactionRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM transactions WHERE transaction_id = $1`,
      [transactionId]
    );
    return result.rows[0] ?? null;
  }

  async findBySender(
    senderAddress: string,
    limit = 100,
    offset = 0
  ): Promise<TransactionRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM transactions
       WHERE sender_address = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [senderAddress, limit, offset]
    );
    return result.rows;
  }

  async findPending(): Promise<TransactionRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM transactions
       WHERE status NOT IN ('completed', 'refunded', 'expired', 'error')
       ORDER BY created_at ASC
       LIMIT 100`
    );
    return result.rows;
  }

  async upsert(record: Omit<TransactionRecord, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO transactions
         (transaction_id, anchor_id, kind, status, status_eta,
          amount_in, amount_out, amount_fee, asset_code,
          stellar_transaction_id, external_transaction_id,
          kyc_status, kyc_fields, kyc_rejection_reason, message, memo, sender_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (transaction_id) DO UPDATE SET
         status                  = EXCLUDED.status,
         amount_in               = COALESCE(EXCLUDED.amount_in, transactions.amount_in),
         amount_out              = COALESCE(EXCLUDED.amount_out, transactions.amount_out),
         amount_fee              = COALESCE(EXCLUDED.amount_fee, transactions.amount_fee),
         stellar_transaction_id  = COALESCE(EXCLUDED.stellar_transaction_id, transactions.stellar_transaction_id),
         external_transaction_id = COALESCE(EXCLUDED.external_transaction_id, transactions.external_transaction_id),
         kyc_status              = COALESCE(EXCLUDED.kyc_status, transactions.kyc_status),
         message                 = COALESCE(EXCLUDED.message, transactions.message),
         updated_at              = NOW()`,
      [
        record.transaction_id,
        record.anchor_id ?? null,
        record.kind ?? null,
        record.status ?? null,
        record.status_eta ?? null,
        record.amount_in ?? null,
        record.amount_out ?? null,
        record.amount_fee ?? null,
        record.asset_code ?? null,
        record.stellar_transaction_id ?? null,
        record.external_transaction_id ?? null,
        record.kyc_status ?? null,
        record.kyc_fields ? JSON.stringify(record.kyc_fields) : null,
        record.kyc_rejection_reason ?? null,
        record.message ?? null,
        record.memo ?? null,
        record.sender_address ?? null,
      ]
    );
  }
}
