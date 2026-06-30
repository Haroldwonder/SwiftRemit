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
import { timingSafeEqual } from 'crypto';
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

export interface TimeSeriesPoint {
  timestamp: string;
  volume: number;
  transaction_count: number;
  fees: number;
}

export interface TimeSeriesResponse {
  success: true;
  data: {
    corridor: string;
    interval: string;
    range: string;
    data: TimeSeriesPoint[];
  };
  timestamp: string;
}

const VALID_RANGES: Record<string, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

const VALID_INTERVALS: Record<string, { pg: string; label: string }> = {
  '1h': { pg: '1 hour', label: '1h' },
  '1d': { pg: '1 day', label: '1d' },
  '1w': { pg: '1 week', label: '1w' },
};

function timestamp(): string {
  return new Date().toISOString();
}

function sendError(res: Response, status: number, message: string, code: string): Response<ErrorResponse> {
  return res.status(status).json({ success: false, error: { message, code }, timestamp: timestamp() });
}

function requireAdminApiKey(adminApiKey?: string) {
  return (req: Request, res: Response, next: () => void): void | Response<ErrorResponse> => {
    if (!adminApiKey) {
      return sendError(res, 500, 'Analytics admin API key is not configured', 'ADMIN_NOT_CONFIGURED');
    }
    const requestApiKey = req.header('x-api-key');
    if (!requestApiKey) {
      return sendError(res, 401, 'Unauthorized', 'UNAUTHORIZED');
    }
    try {
      const keysMatch = timingSafeEqual(Buffer.from(requestApiKey), Buffer.from(adminApiKey));
      if (!keysMatch) return sendError(res, 401, 'Unauthorized', 'UNAUTHORIZED');
    } catch {
      return sendError(res, 401, 'Unauthorized', 'UNAUTHORIZED');
    }
    next();
  };
}

export function createAnalyticsRouter(pool: Pool, adminApiKey?: string): Router {
  const router = Router();
  const adminAuth = requireAdminApiKey(adminApiKey ?? process.env.ANALYTICS_ADMIN_API_KEY);

  router.get('/corridors', adminAuth, async (req: Request, res: Response) => {
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

  /**
   * GET /api/analytics/timeseries
   * Time-series endpoint for charting volume per corridor
   * Query params:
   *   corridor {string}  - Corridor identifier (currency_country, e.g., USDC_UG)
   *   interval {string}  - Bucket interval: 1h | 1d | 1w (default: 1d)
   *   range    {string}  - Time range: 7d | 30d | 90d (default: 30d)
   */
  router.get('/timeseries', adminAuth, async (req: Request, res: Response) => {
    const { corridor, interval: intervalParam, range: rangeParam } = req.query as Record<string, string | undefined>;

    if (!corridor) {
      return sendError(res, 400, 'corridor parameter is required', 'MISSING_CORRIDOR');
    }

    const interval = intervalParam || '1d';
    const range = rangeParam || '30d';

    if (!VALID_RANGES[range]) {
      return sendError(res, 400, `range must be one of: ${Object.keys(VALID_RANGES).join(', ')}`, 'INVALID_RANGE');
    }

    if (!VALID_INTERVALS[interval]) {
      return sendError(res, 400, `interval must be one of: ${Object.keys(VALID_INTERVALS).join(', ')}`, 'INVALID_INTERVAL');
    }

    try {
      const [currency, country] = corridor.split('_');
      if (!currency || !country) {
        return sendError(res, 400, 'corridor must be formatted as CURRENCY_COUNTRY', 'INVALID_CORRIDOR_FORMAT');
      }

      const rangeInterval = VALID_RANGES[range];
      const bucketInterval = VALID_INTERVALS[interval].pg;

      const result = await pool.query<{
        bucket: string;
        volume: string;
        count: string;
        fees: string;
      }>(
        `SELECT
           DATE_TRUNC('${bucketInterval}'::text, timestamp AT TIME ZONE 'UTC') AS bucket,
           SUM(COALESCE(amount, 0)) AS volume,
           COUNT(*) AS count,
           SUM(COALESCE(fee, 0)) AS fees
         FROM contract_events
         WHERE timestamp >= NOW() - INTERVAL '${rangeInterval}'
           AND (raw_data->>'source_currency' = $1 OR raw_data->>'currency' = $1)
           AND (raw_data->>'destination_country' = $2 OR raw_data->>'country' = $2)
           AND event_type IN ('remittance_created', 'remittance_completed')
         GROUP BY bucket
         ORDER BY bucket ASC`,
        [currency, country],
      );

      const data: TimeSeriesPoint[] = result.rows.map((row: {
        bucket: string;
        volume: string;
        count: string;
        fees: string;
      }) => ({
        timestamp: new Date(row.bucket).toISOString(),
        volume: parseFloat(row.volume) || 0,
        transaction_count: parseInt(row.count, 10),
        fees: parseFloat(row.fees) || 0,
      }));

      const response: TimeSeriesResponse = {
        success: true,
        data: {
          corridor,
          interval,
          range,
          data,
        },
        timestamp: timestamp(),
      };

      return res.json(response);
    } catch (err) {
      // eslint-disable-next-line no-console
      void err;
      return sendError(res, 500, 'Failed to fetch time-series data', 'TIMESERIES_ERROR');
    }
  });

  return router;
}
