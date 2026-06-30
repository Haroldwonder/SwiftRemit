import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { RemittanceStore } from '../graphql/resolvers';

export type GraphQLRouterOptions = {
  pool?: Pool;
  remittanceStore?: RemittanceStore;
};

/**
 * Parse and execute simplified GraphQL queries
 * Focuses on field selection without full GraphQL execution engine
 */
function parseQueryFields(query: string): {
  type: string;
  fields: string[];
  variables?: Record<string, unknown>;
} | null {
  const remittancesMatch = query.match(/remittances[^{]*\{([^}]+)\}/);
  const corridorsMatch = query.match(/corridors[^{]*\{([^}]+)\}/);
  const agentsMatch = query.match(/agents\s*\{([^}]+)\}/);

  if (remittancesMatch) {
    const fields = remittancesMatch[1]
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
    return { type: 'remittances', fields };
  }
  if (corridorsMatch) {
    const fields = corridorsMatch[1]
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
    return { type: 'corridors', fields };
  }
  if (agentsMatch) {
    const fields = agentsMatch[1]
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
    return { type: 'agents', fields };
  }

  return null;
}

export function createGraphQLRouter(options: GraphQLRouterOptions = {}): Router {
  const router = Router();
  const { pool, remittanceStore } = options;

  /**
   * POST /api/graphql
   * Simplified GraphQL interface for flexible field selection
   */
  router.post('/', async (req: Request, res: Response) => {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Query is required',
          code: 'INVALID_QUERY',
        },
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const parsed = parseQueryFields(query);

      if (!parsed) {
        return res.status(400).json({
          success: false,
          errors: [
            {
              message: 'Invalid query format',
              code: 'INVALID_QUERY',
            },
          ],
          timestamp: new Date().toISOString(),
        });
      }

      const data: Record<string, unknown> = {};

      if (parsed.type === 'remittances' && remittanceStore) {
        const result = await remittanceStore.queryWithCursor(null, 20);
        data.remittances = result.items;
      }

      if (parsed.type === 'corridors' && pool) {
        const result = await pool.query(`
          SELECT
            COALESCE(raw_data->>'source_currency', 'USDC') AS source_currency,
            COALESCE(raw_data->>'destination_country', 'UNKNOWN') AS destination_country,
            SUM(COALESCE(amount, 0)) AS total_volume,
            COUNT(*) AS transaction_count
          FROM contract_events
          WHERE timestamp >= NOW() - INTERVAL '30 days'
          GROUP BY source_currency, destination_country
          LIMIT 20
        `);
        data.corridors = result.rows;
      }

      if (parsed.type === 'agents' && pool) {
        const result = await pool.query(
          'SELECT address, registered_at, is_active FROM agents LIMIT 20',
        );
        data.agents = result.rows;
      }

      return res.json({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          code: 'GRAPHQL_ERROR',
        },
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * GET /api/graphql
   * GraphQL endpoint info
   */
  router.get('/', (req: Request, res: Response) => {
    res.json({
      success: true,
      message: 'GraphQL API endpoint',
      usage: 'POST to this endpoint with { query: "query { remittances { id sender amount } }" }',
      supportedQueries: ['remittances', 'corridors', 'agents'],
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

export default createGraphQLRouter;
