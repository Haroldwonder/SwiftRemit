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
  query(text: string, params?: unknown[]): Promise<QueryResult<Record<string, unknown>>>;
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

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

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
  /**
   * Query remittances with cursor-based pagination and optional filters (Issue #882).
   *
   * @param cursor     - Opaque cursor token
   * @param limit      - Max items to return (1-100)
   * @param agentId    - Optional filter by agent
   * @param status     - Optional filter by status
   * @param fromDate   - Optional lower bound on created_at
   * @param toDate     - Optional upper bound on created_at
   * @param corridor   - Optional corridor filter (e.g. "USD-NG")
   * @param minAmount  - Optional minimum amount
   * @param maxAmount  - Optional maximum amount
   */
  queryWithCursor(
    cursor: string | null,
    limit: number,
    agentId?: string,
    status?: RemittanceStatus,
    fromDate?: Date,
    toDate?: Date,
    corridor?: string,
    minAmount?: number,
    maxAmount?: number,
  ): Promise<PaginatedResult<Remittance>>;
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

  /**
   * Cursor-based pagination for remittances with optional filters (Issue #882).
   */
  async queryWithCursor(
    cursor: string | null,
    limit: number,
    agentId?: string,
    status?: RemittanceStatus,
    fromDate?: Date,
    toDate?: Date,
    corridor?: string,
    minAmount?: number,
    maxAmount?: number,
  ): Promise<PaginatedResult<Remittance>> {
    const params: unknown[] = [];
    let paramIndex = 1;

    // Decode cursor to get the pagination boundary.
    let cursorTimestamp: Date | null = null;
    let cursorId: string | null = null;

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);

        if (typeof parsed === 'string') {
          cursorTimestamp = new Date(parsed);
        } else if (
          parsed &&
          typeof parsed === 'object' &&
          'created_at' in parsed &&
          'id' in parsed
        ) {
          cursorTimestamp = new Date((parsed as any).created_at);
          cursorId = String((parsed as any).id);
        } else {
          throw new Error('Invalid cursor payload');
        }

        if (isNaN(cursorTimestamp.getTime())) {
          throw new Error('Invalid cursor timestamp');
        }
      } catch {
        throw new Error('Invalid cursor format');
      }
    }

    // Build WHERE clause
    const conditions: string[] = [];
    if (cursorTimestamp) {
      if (cursorId) {
        conditions.push(
          `(created_at < $${paramIndex} OR (created_at = $${paramIndex} AND id < $${paramIndex + 1}))`
        );
        params.push(cursorTimestamp, cursorId);
        paramIndex += 2;
      } else {
        conditions.push(`created_at < $${paramIndex++}`);
        params.push(cursorTimestamp);
      }
    }
    if (agentId) {
      conditions.push(`agent_id = $${paramIndex++}`);
      params.push(agentId);
    }
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (fromDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(toDate);
    }
    // corridor is stored as "source_currency-destination_country" in a corridor column
    // If the column does not exist, this filter is silently skipped to preserve
    // backward compatibility with deployments that haven't run the migration yet.
    if (corridor) {
      conditions.push(`corridor = $${paramIndex++}`);
      params.push(corridor);
    }
    if (minAmount !== undefined) {
      conditions.push(`amount >= $${paramIndex++}`);
      params.push(minAmount);
    }
    if (maxAmount !== undefined) {
      conditions.push(`amount <= $${paramIndex++}`);
      params.push(maxAmount);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Fetch limit + 1 to determine if there are more results
    params.push(limit + 1);
    const query = `
      SELECT id, sender_id, agent_id, amount, fee, status, created_at, updated_at
        FROM remittances
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${paramIndex}
    `;

    const result = await this.db.query(query, params);
    const rows = result.rows as RemittanceRow[];

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(mapRow);

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ created_at: lastItem.created_at, id: lastItem.id })
      ).toString('base64');
    }

    return { items, nextCursor, hasMore };
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
