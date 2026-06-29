import { Pool } from 'pg';
import DataLoader from 'dataloader';

export interface RemittanceStore {
  queryWithCursor(
    cursor: string | null,
    limit: number,
    agent?: string,
    status?: string,
  ): Promise<{
    items: unknown[];
    nextCursor: string | null;
    hasMore: boolean;
  }>;
}

/**
 * DataLoader for batch loading remittances to prevent N+1 queries
 */
function createRemittanceBatchLoader(remittanceStore: RemittanceStore) {
  return new DataLoader(async (ids: (number | string)[]) => {
    const results = await Promise.all(
      ids.map((id) =>
        remittanceStore.queryWithCursor(null, 1).catch(() => null),
      ),
    );
    return results;
  });
}

export function createResolvers(pool: Pool, remittanceStore?: RemittanceStore) {
  const remittanceBatchLoader = remittanceStore
    ? createRemittanceBatchLoader(remittanceStore)
    : null;

  return {
    remittances: async (
      _: unknown,
      args: { agent?: string; status?: string; cursor?: string; limit?: number },
    ) => {
      if (!remittanceStore) {
        throw new Error('Remittance store not configured');
      }

      const result = await remittanceStore.queryWithCursor(
        args.cursor || null,
        args.limit || 20,
        args.agent,
        args.status,
      );

      return result.items || [];
    },

    remittance: async (
      _: unknown,
      args: { id: number },
    ) => {
      if (!pool) {
        throw new Error('Database not configured');
      }

      const result = await pool.query(
        'SELECT * FROM remittances WHERE id = $1',
        [args.id],
      );

      return result.rows[0] || null;
    },

    corridors: async (
      _: unknown,
      args: { range?: string },
    ) => {
      if (!pool) {
        throw new Error('Database not configured');
      }

      const range = args.range || '30d';
      const rangeMap: Record<string, string> = {
        '7d': '7 days',
        '30d': '30 days',
        '90d': '90 days',
      };

      if (!rangeMap[range]) {
        throw new Error('Invalid range parameter');
      }

      const result = await pool.query(
        `SELECT
           COALESCE(raw_data->>'source_currency', raw_data->>'currency', 'USDC') AS source_currency,
           COALESCE(raw_data->>'destination_country', raw_data->>'country', 'UNKNOWN') AS destination_country,
           SUM(COALESCE(amount, 0)) AS total_volume,
           COUNT(*) AS transaction_count,
           COUNT(*) FILTER (WHERE event_type = 'remittance_completed') AS success_count,
           COUNT(*) FILTER (WHERE event_type IN ('remittance_failed', 'remittance_cancelled')) AS failure_count,
           AVG(COALESCE(fee, 0)) AS avg_fee,
           SUM(COALESCE(fee, 0)) AS total_fees
         FROM contract_events
         WHERE timestamp >= NOW() - INTERVAL '${rangeMap[range]}'
           AND event_type IN ('remittance_created', 'remittance_completed', 'remittance_failed', 'remittance_cancelled')
         GROUP BY source_currency, destination_country
         ORDER BY total_volume DESC`,
      );

      return result.rows.map((row) => {
        const total = parseInt(row.transaction_count, 10);
        const success = parseInt(row.success_count, 10);
        return {
          source_currency: row.source_currency,
          destination_country: row.destination_country,
          total_volume: parseFloat(row.total_volume) || 0,
          transaction_count: total,
          success_count: success,
          failure_count: parseInt(row.failure_count, 10),
          success_rate: total > 0 ? (success / total) * 100 : 0,
          avg_fee: parseFloat(row.avg_fee) || 0,
          total_fees: parseFloat(row.total_fees) || 0,
        };
      });
    },

    timeSeries: async (
      _: unknown,
      args: { corridor: string; interval?: string; range?: string },
    ) => {
      if (!pool) {
        throw new Error('Database not configured');
      }

      const { corridor, interval = '1d', range = '30d' } = args;

      const rangeMap: Record<string, string> = {
        '7d': '7 days',
        '30d': '30 days',
        '90d': '90 days',
      };

      const intervalMap: Record<string, string> = {
        '1h': '1 hour',
        '1d': '1 day',
        '1w': '1 week',
      };

      if (!rangeMap[range] || !intervalMap[interval]) {
        throw new Error('Invalid range or interval parameter');
      }

      const [currency, country] = corridor.split('_');
      if (!currency || !country) {
        throw new Error('Invalid corridor format');
      }

      const result = await pool.query(
        `SELECT
           DATE_TRUNC('${intervalMap[interval]}'::text, timestamp AT TIME ZONE 'UTC') AS bucket,
           SUM(COALESCE(amount, 0)) AS volume,
           COUNT(*) AS count,
           SUM(COALESCE(fee, 0)) AS fees
         FROM contract_events
         WHERE timestamp >= NOW() - INTERVAL '${rangeMap[range]}'
           AND (raw_data->>'source_currency' = $1 OR raw_data->>'currency' = $1)
           AND (raw_data->>'destination_country' = $2 OR raw_data->>'country' = $2)
           AND event_type IN ('remittance_created', 'remittance_completed')
         GROUP BY bucket
         ORDER BY bucket ASC`,
        [currency, country],
      );

      return {
        corridor,
        interval,
        range,
        data: result.rows.map((row) => ({
          timestamp: new Date(row.bucket).toISOString(),
          volume: parseFloat(row.volume) || 0,
          transaction_count: parseInt(row.count, 10),
          fees: parseFloat(row.fees) || 0,
        })),
      };
    },

    agents: async () => {
      if (!pool) {
        throw new Error('Database not configured');
      }

      const result = await pool.query(
        'SELECT address, registered_at, is_active FROM agents ORDER BY registered_at DESC',
      );

      return result.rows;
    },

    agent: async (
      _: unknown,
      args: { address: string },
    ) => {
      if (!pool) {
        throw new Error('Database not configured');
      }

      const result = await pool.query(
        'SELECT address, registered_at, is_active FROM agents WHERE address = $1',
        [args.address],
      );

      return result.rows[0] || null;
    },
  };
}
