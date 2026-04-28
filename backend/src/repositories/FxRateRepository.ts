import { Pool } from 'pg';
import { FxRate, FxRateRecord } from '../types';

export class FxRateRepository {
  constructor(private readonly pool: Pool) {}

  async save(fxRate: FxRate): Promise<void> {
    await this.pool.query(
      `INSERT INTO fx_rates (transaction_id, rate, provider, timestamp, from_currency, to_currency)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (transaction_id) DO NOTHING`,
      [fxRate.transaction_id, fxRate.rate, fxRate.provider, fxRate.timestamp, fxRate.from_currency, fxRate.to_currency]
    );
  }

  async findById(transactionId: string): Promise<FxRateRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM fx_rates WHERE transaction_id = $1`,
      [transactionId]
    );
    if (!result.rows[0]) return null;
    const r = result.rows[0];
    return {
      id: r.id,
      transaction_id: r.transaction_id,
      rate: parseFloat(r.rate),
      provider: r.provider,
      timestamp: r.timestamp,
      from_currency: r.from_currency,
      to_currency: r.to_currency,
      created_at: r.created_at,
    };
  }
}
