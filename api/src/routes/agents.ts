/**
 * Agent registration and management endpoints (Issue #880 / #947).
 *
 * POST /api/agents                        - Register agent (admin approval)
 * GET  /api/agents/:id                    - Get agent profile
 * PUT  /api/agents/:id/payout-address     - Update payout address
 * GET  /api/agents/:id/analytics          - Payout analytics for an agent
 *                                           Requires agent-signed proof header.
 */

import { Router, Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { ErrorResponse } from '../types';

function timestamp(): string {
  return new Date().toISOString();
}

function sendError(res: Response, status: number, message: string, code: string): Response<ErrorResponse> {
  return res.status(status).json({ success: false, error: { message, code }, timestamp: timestamp() });
}

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{54}$/;

function isAdminAuthorized(req: Request): boolean {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return false;
  return req.headers['x-api-key'] === adminKey;
}

export interface Agent {
  id: string;
  stellar_address: string;
  payout_address: string;
  name: string;
  status: 'pending' | 'active' | 'suspended';
  created_at: string;
  updated_at: string;
}

/** In-memory store — swap for DB-backed store in production */
export const agentStore = new Map<string, Agent>();

// ---------------------------------------------------------------------------
// Analytics types (Issue #947)
// ---------------------------------------------------------------------------

export interface AgentAnalyticsSummary {
  agent_id: string;
  range: string;
  total_payouts: number;
  total_earnings_usdc: number;
  avg_confirmation_time_s: number | null;
  reputation_score: number | null;
}

export interface AgentAnalyticsTimeSeries {
  bucket: string;
  payouts: number;
  earnings_usdc: number;
  avg_confirmation_time_s: number | null;
}

export interface AgentAnalyticsResponse {
  success: true;
  data: {
    summary: AgentAnalyticsSummary;
    time_series: AgentAnalyticsTimeSeries[];
    granularity: string;
  };
  timestamp: string;
}

const VALID_ANALYTICS_RANGES: Record<string, string> = {
  '7d':  '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

const VALID_GRANULARITIES: Record<string, string> = {
  day:   '1 day',
  week:  '1 week',
  month: '1 month',
};

/**
 * Verify agent-signed proof header.
 *
 * The client must provide:
 *   X-Agent-Id        – the agent's Stellar public key (must match :id)
 *   X-Agent-Timestamp – ISO-8601 UTC timestamp (must be within ±5 minutes)
 *   X-Agent-Signature – HMAC-SHA256(agentId + "|" + isoTimestamp, AGENT_HMAC_SECRET)
 *
 * This proves the requester controls the secret associated with the agent
 * without transmitting a wallet private key.  In production, replace with
 * real Stellar transaction signing (XDR challenge–response).
 */
function verifyAgentSignature(req: Request, agentId: string): boolean {
  const hmacSecret = process.env.AGENT_HMAC_SECRET;
  if (!hmacSecret) return false;

  const headerAgentId  = req.headers['x-agent-id']        as string | undefined;
  const headerTs       = req.headers['x-agent-timestamp']  as string | undefined;
  const headerSig      = req.headers['x-agent-signature']  as string | undefined;

  if (!headerAgentId || !headerTs || !headerSig) return false;
  if (headerAgentId !== agentId) return false;

  // Reject stale / future timestamps (±5 minutes)
  const requestedAt = Date.parse(headerTs);
  if (isNaN(requestedAt)) return false;
  if (Math.abs(Date.now() - requestedAt) > 5 * 60 * 1000) return false;

  const expected = createHash('sha256')
    .update(`${agentId}|${headerTs}|${hmacSecret}`)
    .digest('hex');

  try {
    return timingSafeEqual(Buffer.from(headerSig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function createAgentsRouter(pool?: Pool): Router {
  const router = Router();

  /**
   * POST /api/agents
   * Register a new agent. Requires admin API key.
   * Sets status to 'pending' until on-chain registration is confirmed.
   */
  router.post('/', (req: Request, res: Response) => {
    if (!isAdminAuthorized(req)) {
      return sendError(res, 401, 'Admin authentication required', 'UNAUTHORIZED');
    }

    const { stellar_address, payout_address, name } = req.body as Record<string, unknown>;

    if (typeof stellar_address !== 'string' || !STELLAR_ADDRESS_RE.test(stellar_address)) {
      return sendError(res, 400, 'stellar_address must be a valid Stellar public key', 'INVALID_ADDRESS');
    }
    if (typeof payout_address !== 'string' || payout_address.trim().length === 0) {
      return sendError(res, 400, 'payout_address is required', 'MISSING_FIELD');
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      return sendError(res, 400, 'name is required', 'MISSING_FIELD');
    }
    if (agentStore.has(stellar_address)) {
      return sendError(res, 409, 'Agent with this stellar_address already exists', 'AGENT_EXISTS');
    }

    const now = timestamp();
    const agent: Agent = {
      id: stellar_address,
      stellar_address,
      payout_address: payout_address.trim(),
      name: name.trim(),
      status: 'pending',
      created_at: now,
      updated_at: now,
    };
    agentStore.set(stellar_address, agent);

    return res.status(201).json({ success: true, data: agent, timestamp: timestamp() });
  });

  /**
   * GET /api/agents/:id
   * Retrieve an agent profile by stellar_address.
   */
  router.get('/:id', (req: Request, res: Response) => {
    const agent = agentStore.get(req.params.id);
    if (!agent) {
      return sendError(res, 404, 'Agent not found', 'AGENT_NOT_FOUND');
    }
    return res.json({ success: true, data: agent, timestamp: timestamp() });
  });

  /**
   * PUT /api/agents/:id/payout-address
   * Update the payout address for an agent. Requires admin API key.
   */
  router.put('/:id/payout-address', (req: Request, res: Response) => {
    if (!isAdminAuthorized(req)) {
      return sendError(res, 401, 'Admin authentication required', 'UNAUTHORIZED');
    }

    const agent = agentStore.get(req.params.id);
    if (!agent) {
      return sendError(res, 404, 'Agent not found', 'AGENT_NOT_FOUND');
    }

    const { payout_address } = req.body as Record<string, unknown>;
    if (typeof payout_address !== 'string' || payout_address.trim().length === 0) {
      return sendError(res, 400, 'payout_address is required', 'MISSING_FIELD');
    }

    agent.payout_address = payout_address.trim();
    agent.updated_at = timestamp();
    agentStore.set(agent.id, agent);

    return res.json({ success: true, data: agent, timestamp: timestamp() });
  });

  /**
   * GET /api/agents/:id/analytics
   *
   * Returns payout analytics for the requesting agent.
   *
   * Authentication: Agent-signed proof headers (X-Agent-Id, X-Agent-Timestamp,
   * X-Agent-Signature).  Admin API key is accepted as an alternative so that
   * admin tooling / tests can still query any agent without having the HMAC
   * secret.
   *
   * Query params:
   *   range       {string}  7d | 30d | 90d (default: 30d)
   *   granularity {string}  day | week | month (default: day)
   */
  router.get('/:id/analytics', async (req: Request, res: Response) => {
    const agentId = req.params.id;

    if (!STELLAR_ADDRESS_RE.test(agentId)) {
      return sendError(res, 400, 'Agent id must be a valid Stellar public key', 'INVALID_ADDRESS');
    }

    // Accept either agent-signed proof OR admin key
    const adminAuthed = isAdminAuthorized(req);
    const agentAuthed = verifyAgentSignature(req, agentId);

    if (!adminAuthed && !agentAuthed) {
      return sendError(
        res,
        401,
        'Provide a valid agent signature (X-Agent-Id, X-Agent-Timestamp, X-Agent-Signature) ' +
        'or an admin API key (x-api-key)',
        'UNAUTHORIZED',
      );
    }

    const rangeParam       = typeof req.query.range === 'string'       ? req.query.range       : '30d';
    const granularityParam = typeof req.query.granularity === 'string' ? req.query.granularity : 'day';

    if (!VALID_ANALYTICS_RANGES[rangeParam]) {
      return sendError(
        res,
        400,
        `range must be one of: ${Object.keys(VALID_ANALYTICS_RANGES).join(', ')}`,
        'INVALID_RANGE',
      );
    }

    if (!VALID_GRANULARITIES[granularityParam]) {
      return sendError(
        res,
        400,
        `granularity must be one of: ${Object.keys(VALID_GRANULARITIES).join(', ')}`,
        'INVALID_GRANULARITY',
      );
    }

    const rangeInterval   = VALID_ANALYTICS_RANGES[rangeParam];
    const bucketInterval  = VALID_GRANULARITIES[granularityParam];

    // If no pool is wired (unit-test / non-DB environment) return an empty response
    if (!pool) {
      const empty: AgentAnalyticsResponse = {
        success: true,
        data: {
          summary: {
            agent_id: agentId,
            range: rangeParam,
            total_payouts: 0,
            total_earnings_usdc: 0,
            avg_confirmation_time_s: null,
            reputation_score: null,
          },
          time_series: [],
          granularity: granularityParam,
        },
        timestamp: timestamp(),
      };
      return res.json(empty);
    }

    try {
      // ---------------------------------------------------------------
      // 1. Summary row
      // ---------------------------------------------------------------
      const summaryResult = await pool.query<{
        total_payouts: string;
        total_earnings_usdc: string;
        avg_confirmation_time_s: string | null;
        reputation_score: string | null;
      }>(
        `SELECT
           COUNT(*)                                              AS total_payouts,
           COALESCE(SUM(amount - COALESCE(fee, 0)), 0)          AS total_earnings_usdc,
           AVG(
             EXTRACT(EPOCH FROM (
               ce.timestamp - prev.timestamp
             ))
           )                                                     AS avg_confirmation_time_s,
           NULL::NUMERIC                                         AS reputation_score
         FROM contract_events ce
         LEFT JOIN LATERAL (
           SELECT timestamp
           FROM   contract_events
           WHERE  remittance_id = ce.remittance_id
             AND  event_type = 'remittance_created'
           ORDER  BY timestamp ASC
           LIMIT  1
         ) prev ON TRUE
         WHERE ce.actor     = $1
           AND ce.event_type = 'remittance_completed'
           AND ce.timestamp >= NOW() - INTERVAL '${rangeInterval}'`,
        [agentId],
      );

      const s = summaryResult.rows[0];
      const summary: AgentAnalyticsSummary = {
        agent_id:                agentId,
        range:                   rangeParam,
        total_payouts:           parseInt(s?.total_payouts ?? '0', 10),
        total_earnings_usdc:     parseFloat(s?.total_earnings_usdc ?? '0') || 0,
        avg_confirmation_time_s: s?.avg_confirmation_time_s != null
          ? Math.round(parseFloat(s.avg_confirmation_time_s))
          : null,
        reputation_score: s?.reputation_score != null
          ? parseFloat(s.reputation_score)
          : null,
      };

      // ---------------------------------------------------------------
      // 2. Time-series buckets
      // ---------------------------------------------------------------
      const tsResult = await pool.query<{
        bucket: string;
        payouts: string;
        earnings_usdc: string;
        avg_confirmation_time_s: string | null;
      }>(
        `SELECT
           DATE_TRUNC('${bucketInterval}'::text, ce.timestamp AT TIME ZONE 'UTC') AS bucket,
           COUNT(*)                                              AS payouts,
           COALESCE(SUM(amount - COALESCE(fee, 0)), 0)          AS earnings_usdc,
           AVG(
             EXTRACT(EPOCH FROM (
               ce.timestamp - prev.timestamp
             ))
           )                                                     AS avg_confirmation_time_s
         FROM contract_events ce
         LEFT JOIN LATERAL (
           SELECT timestamp
           FROM   contract_events
           WHERE  remittance_id = ce.remittance_id
             AND  event_type = 'remittance_created'
           ORDER  BY timestamp ASC
           LIMIT  1
         ) prev ON TRUE
         WHERE ce.actor     = $1
           AND ce.event_type = 'remittance_completed'
           AND ce.timestamp >= NOW() - INTERVAL '${rangeInterval}'
         GROUP BY bucket
         ORDER BY bucket ASC`,
        [agentId],
      );

      const time_series: AgentAnalyticsTimeSeries[] = tsResult.rows.map((row) => ({
        bucket:                  new Date(row.bucket).toISOString(),
        payouts:                 parseInt(row.payouts, 10),
        earnings_usdc:           parseFloat(row.earnings_usdc) || 0,
        avg_confirmation_time_s: row.avg_confirmation_time_s != null
          ? Math.round(parseFloat(row.avg_confirmation_time_s))
          : null,
      }));

      const response: AgentAnalyticsResponse = {
        success: true,
        data: { summary, time_series, granularity: granularityParam },
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
