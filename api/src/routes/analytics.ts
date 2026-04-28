/**
 * GET /api/analytics/corridors (#482)
 *
 * Returns remittance volume, fees, and success/failure rates per corridor
 * (currency/country pair) sourced from the contract_events table.
 *
 * Query params:
 *   range  {string}  - Time range: 7d | 30d | 90d (default: 30d)
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { ErrorResponse } from '../types';

export interface CorridorStat {
  source_currency: string;
  destination_country: string;
  total_volume: number;
  transaction_count: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
  avg_fee: number;
  total_fees: number;
}

export interface CorridorAnalyticsResponse {
  success: true;
  data: {
    range: string;
    corridors: CorridorStat[];
    top_by_volume: CorridorStat[];
  };
  timestamp: string;
}

const VALID_RANGES: Record<string, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

function timestamp(): string {
  return new Date().toISOString();
}

function sendError(res: Response, status: number, message: string, code: string): Response<ErrorResponse> {
  return res.status(status).json({ success: false, error: { message, code }, timestamp: timestamp() });
}

export function createAnalyticsRouter(pool: Pool): Router {
  const router = Router();

  router.get('/corridors', async (req: Request, res: Response) => {
    const rangeParam = typeof req.query.range === 'string' ? req.query.range : '30d';

    if (!VALID_RANGES[rangeParam]) {
      return sendError(res, 400, `range must be one of: ${Object.keys(VALID_RANGES).join(', ')}`, 'INVALID_RANGE');
    }

    const interval = VALID_RANGES[rangeParam];

    try {
      // contract_events stores raw_data JSONB with currency/country fields when available.
      // We aggregate by (source_currency, destination_country) from raw_data.
      const result = await pool.query<{
        source_currency: string;
        destination_country: string;
        total_volume: string;
        transaction_count: string;
        success_count: string;
        failure_count: string;
        avg_fee: string;
        total_fees: string;
      }>(        `SELECT
           COALESCE(raw_data->>'source_currency', raw_data->>'currency', 'USDC') AS source_currency,
           COALESCE(raw_data->>'destination_country', raw_data->>'country', 'UNKNOWN') AS destination_country,
           SUM(COALESCE(amount, 0))                                                    AS total_volume,
           COUNT(*)                                                                    AS transaction_count,
           COUNT(*) FILTER (WHERE event_type = 'remittance_completed')                AS success_count,
           COUNT(*) FILTER (WHERE event_type IN ('remittance_failed', 'remittance_cancelled')) AS failure_count,
           AVG(COALESCE(fee, 0))                                                       AS avg_fee,
           SUM(COALESCE(fee, 0))                                                       AS total_fees
         FROM contract_events
         WHERE timestamp >= NOW() - INTERVAL '${interval}'
           AND event_type IN ('remittance_created', 'remittance_completed', 'remittance_failed', 'remittance_cancelled')
         GROUP BY source_currency, destination_country
         ORDER BY total_volume DESC NULLS LAST`,
        []
      );

      const corridors: CorridorStat[] = result.rows.map((row: {
        source_currency: string;
        destination_country: string;
        total_volume: string;
        transaction_count: string;
        success_count: string;
        failure_count: string;
        avg_fee: string;
        total_fees: string;
      }) => {
        const total = parseInt(row.transaction_count, 10);
        const success = parseInt(row.success_count, 10);
        return {
          source_currency: row.source_currency,
          destination_country: row.destination_country,
          total_volume: parseFloat(row.total_volume) || 0,
          transaction_count: total,
          success_count: success,
          failure_count: parseInt(row.failure_count, 10),
          success_rate: total > 0 ? Math.round((success / total) * 10000) / 100 : 0,
          avg_fee: parseFloat(row.avg_fee) || 0,
          total_fees: parseFloat(row.total_fees) || 0,
        };
      });

      const top_by_volume = [...corridors]
        .sort((a, b) => b.total_volume - a.total_volume)
        .slice(0, 10);

      const response: CorridorAnalyticsResponse = {
        success: true,
        data: { range: rangeParam, corridors, top_by_volume },
        timestamp: timestamp(),
      };

      return res.json(response);
    } catch (err) {
      // eslint-disable-next-line no-console
      void err;
      return sendError(res, 500, 'Failed to fetch corridor analytics', 'ANALYTICS_ERROR');
    }
  });

  return router;
}
