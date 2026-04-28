import { Pool, QueryResult } from 'pg';
import { AnchorProvider } from '../types/anchor';

type AnchorStatus = AnchorProvider['status'];

type Queryable = {
  query(text: string, params?: any[]): Promise<QueryResult<any>>;
};

type AnchorRow = {
  id: string;
  name: string;
  domain: string;
  logo_url: string | null;
  description: string;
  status: AnchorStatus;
  fees: AnchorProvider['fees'];
  limits: AnchorProvider['limits'];
  compliance: AnchorProvider['compliance'];
  supported_currencies: string[];
  processing_time: string;
  rating: string | number | null;
  total_transactions: number | null;
  verified: boolean;
  enabled: boolean;
};

export type AnchorFilters = {
  status?: string;
  currency?: string;
  currencies?: string[];
};

export type AnchorUpdateInput = Partial<AnchorProvider>;

const FULL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS anchors (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    public_key VARCHAR(56) NOT NULL DEFAULT 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    webhook_secret VARCHAR(255),
    home_domain VARCHAR(255),
    domain VARCHAR(255) NOT NULL,
    logo_url TEXT,
    description TEXT NOT NULL,
    status VARCHAR(32) NOT NULL,
    fees JSONB NOT NULL,
    limits JSONB NOT NULL,
    compliance JSONB NOT NULL,
    supported_currencies TEXT[] NOT NULL DEFAULT '{}',
    processing_time VARCHAR(255) NOT NULL,
    rating NUMERIC(3, 1),
    total_transactions INTEGER,
    verified BOOLEAN NOT NULL DEFAULT false,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
`;

function mapAnchorRow(row: AnchorRow): AnchorProvider {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    logo_url: row.logo_url ?? undefined,
    description: row.description,
    status: row.status,
    fees: row.fees,
    limits: row.limits,
    compliance: row.compliance,
    supported_currencies: row.supported_currencies,
    processing_time: row.processing_time,
    rating: row.rating == null ? undefined : Number(row.rating),
    total_transactions: row.total_transactions ?? undefined,
    verified: row.verified,
  };
}

function toInsertParams(anchor: AnchorProvider): any[] {
  return [
    anchor.id,
    anchor.name,
    anchor.domain,
    anchor.logo_url ?? null,
    anchor.description,
    anchor.status,
    JSON.stringify(anchor.fees),
    JSON.stringify(anchor.limits),
    JSON.stringify(anchor.compliance),
    anchor.supported_currencies,
    anchor.processing_time,
    anchor.rating ?? null,
    anchor.total_transactions ?? null,
    anchor.verified,
  ];
}

function isValidStatus(value: string): value is AnchorStatus {
  return value === 'active' || value === 'inactive' || value === 'maintenance';
}

export interface AnchorStore {
  list(filters?: AnchorFilters): Promise<AnchorProvider[]>;
  getById(id: string): Promise<AnchorProvider | null>;
  create(anchor: AnchorProvider): Promise<AnchorProvider>;
  update(id: string, updates: AnchorUpdateInput): Promise<AnchorProvider | null>;
  deactivate(id: string): Promise<AnchorProvider | null>;
  delete(id: string): Promise<boolean>;
}

export class PostgresAnchorStore implements AnchorStore {
  constructor(private readonly db: Queryable) {}

  async initializeSchema(): Promise<void> {
    await this.db.query(FULL_SCHEMA_SQL);
  }

  async seed(anchors: AnchorProvider[]): Promise<void> {
    for (const anchor of anchors) {
      await this.db.query(
        `
          INSERT INTO anchors (
            id, name, domain, logo_url, description, status,
            fees, limits, compliance, supported_currencies,
            processing_time, rating, total_transactions, verified, enabled,
            home_domain
          )
          VALUES (
            $1, $2, $3, $4, $5, $6,
            $7::jsonb, $8::jsonb, $9::jsonb, $10::text[],
            $11, $12, $13, $14, true, $3
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            domain = EXCLUDED.domain,
            logo_url = EXCLUDED.logo_url,
            description = EXCLUDED.description,
            status = EXCLUDED.status,
            fees = EXCLUDED.fees,
            limits = EXCLUDED.limits,
            compliance = EXCLUDED.compliance,
            supported_currencies = EXCLUDED.supported_currencies,
            processing_time = EXCLUDED.processing_time,
            rating = EXCLUDED.rating,
            total_transactions = EXCLUDED.total_transactions,
            verified = EXCLUDED.verified,
            enabled = true,
            home_domain = EXCLUDED.home_domain,
            updated_at = NOW()
        `,
        toInsertParams(anchor),
      );
    }
  }

  async list(filters: AnchorFilters = {}): Promise<AnchorProvider[]> {
    const clauses = ['enabled = true'];
    const params: any[] = [];

    if (filters.status) {
      params.push(filters.status);
      clauses.push(`status = $${params.length}`);
    }

    // currencies[] takes precedence; fall back to single currency
    const currencyList = filters.currencies?.length
      ? filters.currencies
      : filters.currency
        ? [filters.currency]
        : [];

    if (currencyList.length === 1) {
      params.push(currencyList[0].toUpperCase());
      clauses.push(`$${params.length} = ANY(supported_currencies)`);
    } else if (currencyList.length > 1) {
      params.push(currencyList.map(c => c.toUpperCase()));
      // Anchor must support ALL requested currencies
      clauses.push(`$${params.length}::text[] <@ supported_currencies`);
    }

    const result = await this.db.query(
      `
        SELECT
          id, name, domain, logo_url, description, status,
          fees, limits, compliance, supported_currencies,
          processing_time, rating, total_transactions, verified, enabled
        FROM anchors
        WHERE ${clauses.join(' AND ')}
        ORDER BY id ASC
      `,
      params,
    );

    return result.rows.map(row => mapAnchorRow(row as AnchorRow));
  }

  async getById(id: string): Promise<AnchorProvider | null> {
    const result = await this.db.query(
      `
        SELECT
          id, name, domain, logo_url, description, status,
          fees, limits, compliance, supported_currencies,
          processing_time, rating, total_transactions, verified, enabled
        FROM anchors
        WHERE id = $1 AND enabled = true
      `,
      [id],
    );

    return result.rows[0] ? mapAnchorRow(result.rows[0] as AnchorRow) : null;
  }

  async create(anchor: AnchorProvider): Promise<AnchorProvider> {
    const result = await this.db.query(
      `
        INSERT INTO anchors (
          id, name, domain, logo_url, description, status,
          fees, limits, compliance, supported_currencies,
          processing_time, rating, total_transactions, verified, enabled,
          home_domain
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7::jsonb, $8::jsonb, $9::jsonb, $10::text[],
          $11, $12, $13, $14, true, $3
        )
        RETURNING
          id, name, domain, logo_url, description, status,
          fees, limits, compliance, supported_currencies,
          processing_time, rating, total_transactions, verified, enabled
      `,
      toInsertParams(anchor),
    );

    return mapAnchorRow(result.rows[0] as AnchorRow);
  }

  async update(id: string, updates: AnchorUpdateInput): Promise<AnchorProvider | null> {
    const assignments: string[] = [];
    const params: any[] = [];

    const addAssignment = (column: string, value: any, cast?: string) => {
      params.push(value);
      assignments.push(
        cast ? `${column} = $${params.length}::${cast}` : `${column} = $${params.length}`,
      );
    };

    if (updates.name !== undefined) addAssignment('name', updates.name);
    if (updates.domain !== undefined) {
      addAssignment('domain', updates.domain);
      addAssignment('home_domain', updates.domain);
    }
    if (updates.logo_url !== undefined) addAssignment('logo_url', updates.logo_url);
    if (updates.description !== undefined) addAssignment('description', updates.description);
    if (updates.status !== undefined) addAssignment('status', updates.status);
    if (updates.fees !== undefined) addAssignment('fees', JSON.stringify(updates.fees), 'jsonb');
    if (updates.limits !== undefined) addAssignment('limits', JSON.stringify(updates.limits), 'jsonb');
    if (updates.compliance !== undefined) {
      addAssignment('compliance', JSON.stringify(updates.compliance), 'jsonb');
    }
    if (updates.supported_currencies !== undefined) {
      addAssignment('supported_currencies', updates.supported_currencies, 'text[]');
    }
    if (updates.processing_time !== undefined) {
      addAssignment('processing_time', updates.processing_time);
    }
    if (updates.rating !== undefined) addAssignment('rating', updates.rating);
    if (updates.total_transactions !== undefined) {
      addAssignment('total_transactions', updates.total_transactions);
    }
    if (updates.verified !== undefined) addAssignment('verified', updates.verified);

    if (assignments.length === 0) {
      return this.getById(id);
    }

    assignments.push('updated_at = NOW()');
    params.push(id);

    const result = await this.db.query(
      `
        UPDATE anchors
        SET ${assignments.join(', ')}
        WHERE id = $${params.length}
        RETURNING
          id, name, domain, logo_url, description, status,
          fees, limits, compliance, supported_currencies,
          processing_time, rating, total_transactions, verified, enabled
      `,
      params,
    );

    const row = result.rows[0] as AnchorRow | undefined;
    if (!row || !row.enabled) {
      return null;
    }

    return mapAnchorRow(row);
  }

  async deactivate(id: string): Promise<AnchorProvider | null> {
    const result = await this.db.query(
      `
        UPDATE anchors
        SET enabled = false, status = 'inactive', updated_at = NOW()
        WHERE id = $1
        RETURNING
          id, name, domain, logo_url, description, status,
          fees, limits, compliance, supported_currencies,
          processing_time, rating, total_transactions, verified, enabled
      `,
      [id],
    );

    return result.rows[0] ? mapAnchorRow(result.rows[0] as AnchorRow) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.query('DELETE FROM anchors WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}

let defaultStore: PostgresAnchorStore | null = null;

export function createAnchorPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for anchor storage');
  }

  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

export function getDefaultAnchorStore(): PostgresAnchorStore {
  if (!defaultStore) {
    defaultStore = new PostgresAnchorStore(createAnchorPool());
  }

  return defaultStore;
}

export function isAnchorStatus(value: string): value is AnchorStatus {
  return isValidStatus(value);
}
