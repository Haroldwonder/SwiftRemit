import { Pool } from 'pg';
import type { ContractEvent, ContractEventFilter } from '../database';

export class ContractEventRepository {
  constructor(private readonly pool: Pool) {}

  async save(event: ContractEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO contract_events
         (event_type, remittance_id, actor, amount, fee, tx_hash, ledger_sequence, timestamp, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING`,
      [
        event.event_type,
        event.remittance_id ?? null,
        event.actor ?? null,
        event.amount ?? null,
        event.fee ?? null,
        event.tx_hash ?? null,
        event.ledger_sequence ?? null,
        event.timestamp,
        event.raw_data ? JSON.stringify(event.raw_data) : null,
      ]
    );
  }

  async query(filter: ContractEventFilter): Promise<{ events: ContractEvent[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.event_type) {
      conditions.push(`event_type = $${idx++}`);
      params.push(filter.event_type);
    }
    if (filter.actor) {
      conditions.push(`actor = $${idx++}`);
      params.push(filter.actor);
    }
    if (filter.remittance_id !== undefined) {
      conditions.push(`remittance_id = $${idx++}`);
      params.push(filter.remittance_id);
    }
    if (filter.from) {
      conditions.push(`timestamp >= $${idx++}`);
      params.push(filter.from);
    }
    if (filter.to) {
      conditions.push(`timestamp <= $${idx++}`);
      params.push(filter.to);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filter.limit ?? 50, 200);
    const offset = filter.offset ?? 0;

    const [dataResult, countResult] = await Promise.all([
      this.pool.query(
        `SELECT * FROM contract_events ${where} ORDER BY timestamp DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
      this.pool.query(`SELECT COUNT(*) FROM contract_events ${where}`, params),
    ]);

    return {
      events: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  }
}
