/**
 * Agent registration and management endpoints (Issue #880).
 *
 * POST /api/agents                     - Register agent (admin approval)
 * GET  /api/agents/:id                 - Get agent profile
 * PUT  /api/agents/:id/payout-address  - Update payout address
 */

import { Router, Request, Response } from 'express';
import { ErrorResponse } from '../types';
import { sanitizeInput } from '../utils/sanitize.js';
import { extractBearerToken, verifyAccessToken } from '../middleware/auth.js';

function timestamp(): string {
  return new Date().toISOString();
}

function sendError(res: Response, status: number, message: string, code: string): Response<ErrorResponse> {
  return res.status(status).json({ success: false, error: { message, code }, timestamp: timestamp() });
}

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{54}$/;

/**
 * Elevated authorisation for agent registration and payout-address changes
 * (SR-048).
 *
 * Accepts either the pre-existing shared admin API key or a verified access
 * token carrying the `agent` or `admin` role. The API-key path is kept so
 * existing operational tooling keeps working; the token path is what lets an
 * individual agent act as themselves instead of sharing one secret.
 */
function isAdminAuthorized(req: Request): boolean {
  const adminKey = process.env.ADMIN_API_KEY;
  if (adminKey && req.headers['x-api-key'] === adminKey) return true;

  const token = extractBearerToken(req);
  if (!token) return false;

  const result = verifyAccessToken(token);
  return result.ok && (result.auth.role === 'agent' || result.auth.role === 'admin');
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

export function createAgentsRouter(): Router {
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
      payout_address: sanitizeInput(payout_address.trim()),
      name: sanitizeInput(name.trim()),
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
  router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
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
  router.put('/:id/payout-address', (req: Request<{ id: string }>, res: Response) => {
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

    agent.payout_address = sanitizeInput(payout_address.trim());
    agent.updated_at = timestamp();
    agentStore.set(agent.id, agent);

    return res.json({ success: true, data: agent, timestamp: timestamp() });
  });

  return router;
}
