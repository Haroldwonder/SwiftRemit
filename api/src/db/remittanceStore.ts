/**
 * Remittance persistence layer.
 *
 * Provides typed access to the `remittances` table. All status mutations go
 * through `updateStatus()` — the single choke-point that the service layer
 * wraps with `emitStatusChange()`.
 */

import { Pool, QueryResult } from 'pg';
import { RemittanceStatus } from '../websocket/types';

// ── Types ──────────────────────────────────────────────────────────────────

export interface Remittance {
  id: string;
  sender_id: string;
  agent_id: string;
  amount: number;
  fee: number;
  status: RemittanceStatus;
  created_at: string;
  updated_at: string;
}

type Queryable = {
  query(text: string, params?: unknown[]): Promise<QueryResult<unknown>>;
};

type RemittanceRow = {
  id: string;
  sender_id: string;
  agent_id: string;
  amount: string | number;
  fee: string | number;
  status: RemittanceStatus;
  created_at: Date | string;
  updated_at: Date | string;
};

// ── Schema ─────────────────────────────────────────────────────────────────

export const REMITTANCE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS remittances (
    id          VARCHAR(255) PRIMARY KEY,
    sender_id   VARCHAR(255) NOT NULL,
    agent_id    VARCHAR(255) NOT NULL,
    amount      BIGINT       NOT NULL,
    fee         BIGINT       NOT NULL DEFAULT 0,
    status      VARCHAR(32)  NOT NULL DEFAULT 'Pending',
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
  );
`;

// ── Mapper ─────────────────────────────────────────────────────────────────

function mapRow(row: RemittanceRow): Remittance {
  return {
    id: row.id,
    sender_id: row.sender_id,
    agent_id: row.agent_id,
    amount: Number(row.amount),
    fee: Number(row.fee),
    status: row.status,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}

// ── Interface ──────────────────────────────────────────────────────────────

export interface RemittanceStore {
  getById(id: string): Promise<Remittance | null>;
  create(remittance: Omit<Remittance, 'created_at' | 'updated_at'>): Promise<Remittance>;
  /**
   * Persists a new status for the given remittance.
   *
   * Returns the updated record on success, or `null` if no row matched `id`.
   * The caller (RemittanceService) is responsible for emitting the WebSocket
   * event after this resolves successfully.
   */
  updateStatus(id: string, status: RemittanceStatus): Promise<Remittance | null>;
}

// ── Implementation ─────────────────────────────────────────────────────────

export class PostgresRemittanceStore implements RemittanceStore {
  constructor(private readonly db: Queryable) {}

  async initializeSchema(): Promise<void> {
    await this.db.query(REMITTANCE_SCHEMA_SQL);
  }

  async getById(id: string): Promise<Remittance | null> {
    const result = await this.db.query(
      `SELECT id, sender_id, agent_id, amount, fee, status, created_at, updated_at
         FROM remittances
        WHERE id = $1`,
      [id],
    );
    const row = result.rows[0] as RemittanceRow | undefined;
    return row ? mapRow(row) : null;
  }

  async create(
    remittance: Omit<Remittance, 'created_at' | 'updated_at'>,
  ): Promise<Remittance> {
    const result = await this.db.query(
      `INSERT INTO remittances (id, sender_id, agent_id, amount, fee, status)
            VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, sender_id, agent_id, amount, fee, status, created_at, updated_at`,
      [
        remittance.id,
        remittance.sender_id,
        remittance.agent_id,
        remittance.amount,
        remittance.fee,
        remittance.status,
      ],
    );
    return mapRow(result.rows[0] as RemittanceRow);
  }

  /**
   * Updates the status column and bumps `updated_at` atomically.
   * Returns the full updated row, or `null` if the id was not found.
   */
  async updateStatus(id: string, status: RemittanceStatus): Promise<Remittance | null> {
    const result = await this.db.query(
      `UPDATE remittances
            SET status = $1, updated_at = NOW()
          WHERE id = $2
          RETURNING id, sender_id, agent_id, amount, fee, status, created_at, updated_at`,
      [status, id],
    );
    const row = result.rows[0] as RemittanceRow | undefined;
    return row ? mapRow(row) : null;
  }
}

// ── Singleton pool factory ─────────────────────────────────────────────────

let defaultStore: PostgresRemittanceStore | null = null;

export function createRemittancePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for remittance storage');
  }
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
  });
}

export function getDefaultRemittanceStore(): PostgresRemittanceStore {
  if (!defaultStore) {
    defaultStore = new PostgresRemittanceStore(createRemittancePool());
  }
  return defaultStore;
}
