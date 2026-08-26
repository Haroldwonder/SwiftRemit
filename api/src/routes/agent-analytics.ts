/**
 * GET /api/agents/:id/analytics  (Issue #947)
 *
 * Agent-facing payout analytics — earnings, performance metrics, and time-series
 * breakdown. Requires the agent to prove ownership via a bearer token or API key.
 *
 * Query params:
 *   from     {string}  - ISO-8601 start date (default: 30 days ago)
 *   to       {string}  - ISO-8601 end date   (default: now)
 *   interval {string}  - Bucket size for time-series: day | week | month (default: day)
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { ErrorResponse } from '../types';
import { extractBearerToken, verifyAccessToken } from '../middleware/auth.js';

const VALID_INTERVALS = ['day', 'week', 'month'] as const;
type Interval = (typeof VALID_INTERVALS)[number];

const PG_TRUNCMAP: Record<Interval, string> = {
  day: '1 day',
  week: '1 week',
  month: '1 month',
};

function timestamp(): string {
  return new Date().toISOString();
}

function sendError(
  res: Response,
  status: number,
  message: string,
  code: string,
): Response<ErrorResponse> {
  return res.status(status).json({
    success: false,
    error: { message, code },
    timestamp: timestamp(),
  });
}

/** Verify the request carries a credential tied to the given agent address. */
function isAgentAuthorized(req: Request, agentId: string): boolean {
  // Option A: admin API key (operational tooling)
  const adminKey = process.env.ADMIN_API_KEY;
  if (adminKey && req.headers['x-api-key'] === adminKey) return true;

  // Option B: JWT with matching subject/address (SR-048)
  const token = extractBearerToken(req);
  if (!token) return false;
  const result = verifyAccessToken(token);
  if (!result.ok) return false;
  const { role, sub } = result.auth as { role: string; sub?: string };
  if (role === 'admin') return true;
  if (role === 'agent' && sub === agentId) return true;
  return false;
}

export interface AgentAnalyticsSummary {
  agent_id: string;
  from: string;
  to: string;
  total_payouts: number;
  total_earnings_usdc: number;
  avg_confirmation_time_seconds: number;
  reputation_score: number | null;
  success_rate: number;
}

export interface AgentTimeSeriesPoint {
  bucket: string;
  payouts: number;
  earnings_usdc: number;
  avg_confirmation_time_seconds: number;
}

export interface AgentAnalyticsResponse {
  success: true;
  data: {
    summary: AgentAnalyticsSummary;
    time_series: AgentTimeSeriesPoint[];
    interval: Interval;
  };
  timestamp: string;
}

export function createAgentAnalyticsRouter(pool: Pool): Router {
  const router = Router({ mergeParams: true });

  /**
   * GET /api/agents/:id/analytics
   */
  router.get('/', async (req: Request<{ id: string }>, res: Response) => {
    const agentId = req.params.id;

    if (!isAgentAuthorized(req, agentId)) {
      return sendError(res, 401, 'Agent authentication required', 'UNAUTHORIZED');
    }

    // ── Parse query params ────────────────────────────────────────────────────
    const toDate = req.query.to
      ? new Date(req.query.to as string)
      : new Date();
    const fromDate = req.query.from
      ? new Date(req.query.from as string)
      : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return sendError(res, 400, 'Invalid date format — use ISO-8601', 'INVALID_DATE');
    }
    if (fromDate >= toDate) {
      return sendError(res, 400, "'from' must be before 'to'", 'INVALID_DATE_RANGE');
    }

    const intervalParam = (req.query.interval as string) || 'day';
    if (!VALID_INTERVALS.includes(intervalParam as Interval)) {
      return sendError(
        res,
        400,
        `interval must be one of: ${VALID_INTERVALS.join(', ')}`,
        'INVALID_INTERVAL',
      );
    }
    const interval = intervalParam as Interval;
    const bucketInterval = PG_TRUNCMAP[interval];

    try {
      // ── Summary query ────────────────────────────────────────────────────────
      const summaryResult = await pool.query<{
        total_payouts: string;
        total_earnings: string;
        avg_confirmation_seconds: string;
        success_count: string;
        failure_count: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE event_type = 'remittance_completed')      AS total_payouts,
           SUM(COALESCE(fee, 0)) FILTER (WHERE event_type = 'remittance_completed') AS total_earnings,
           AVG(
             EXTRACT(EPOCH FROM (completed_at - created_at))
           ) FILTER (WHERE event_type = 'remittance_completed')             AS avg_confirmation_seconds,
           COUNT(*) FILTER (WHERE event_type = 'remittance_completed')      AS success_count,
           COUNT(*) FILTER (WHERE event_type IN ('remittance_failed', 'remittance_cancelled')) AS failure_count
         FROM contract_events
         WHERE (raw_data->>'agent' = $1 OR raw_data->>'agent_address' = $1)
           AND timestamp BETWEEN $2 AND $3`,
        [agentId, fromDate.toISOString(), toDate.toISOString()],
      );

      const row = summaryResult.rows[0];
      const totalPayouts = parseInt(row?.total_payouts ?? '0', 10);
      const successCount = parseInt(row?.success_count ?? '0', 10);
      const failureCount = parseInt(row?.failure_count ?? '0', 10);
      const totalAttempts = successCount + failureCount;
      const successRate =
        totalAttempts > 0 ? Math.round((successCount / totalAttempts) * 10000) / 100 : 0;

      // ── Reputation score (best-effort — may not be in DB) ────────────────────
      let reputationScore: number | null = null;
      try {
        const repResult = await pool.query<{ reputation_score: string }>(
          `SELECT reputation_score FROM agents WHERE stellar_address = $1 LIMIT 1`,
          [agentId],
        );
        if (repResult.rows.length > 0 && repResult.rows[0].reputation_score != null) {
          reputationScore = parseFloat(repResult.rows[0].reputation_score);
        }
      } catch {
        // agents table may not exist in all environments — ignore
      }

      const summary: AgentAnalyticsSummary = {
        agent_id: agentId,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        total_payouts: totalPayouts,
        total_earnings_usdc: parseFloat(row?.total_earnings ?? '0') || 0,
        avg_confirmation_time_seconds:
          parseFloat(row?.avg_confirmation_seconds ?? '0') || 0,
        reputation_score: reputationScore,
        success_rate: successRate,
      };

      // ── Time-series query ─────────────────────────────────────────────────────
      const tsResult = await pool.query<{
        bucket: string;
        payouts: string;
        earnings: string;
        avg_confirmation: string;
      }>(
        `SELECT
           DATE_TRUNC('${bucketInterval}'::text, timestamp AT TIME ZONE 'UTC') AS bucket,
           COUNT(*) FILTER (WHERE event_type = 'remittance_completed')       AS payouts,
           SUM(COALESCE(fee, 0)) FILTER (WHERE event_type = 'remittance_completed') AS earnings,
           AVG(
             EXTRACT(EPOCH FROM (completed_at - created_at))
           ) FILTER (WHERE event_type = 'remittance_completed')              AS avg_confirmation
         FROM contract_events
         WHERE (raw_data->>'agent' = $1 OR raw_data->>'agent_address' = $1)
           AND timestamp BETWEEN $2 AND $3
         GROUP BY bucket
         ORDER BY bucket ASC`,
        [agentId, fromDate.toISOString(), toDate.toISOString()],
      );

      const timeSeries: AgentTimeSeriesPoint[] = tsResult.rows.map((r) => ({
        bucket: new Date(r.bucket).toISOString(),
        payouts: parseInt(r.payouts, 10),
        earnings_usdc: parseFloat(r.earnings) || 0,
        avg_confirmation_time_seconds: parseFloat(r.avg_confirmation) || 0,
      }));

      const response: AgentAnalyticsResponse = {
        success: true,
        data: { summary, time_series: timeSeries, interval },
        timestamp: timestamp(),
      };

      return res.json(response);
    } catch (err) {
      void err;
      return sendError(res, 500, 'Failed to fetch agent analytics', 'ANALYTICS_ERROR');
    }
  });

  return router;
}
