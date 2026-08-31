/**
 * Agent registration and management endpoints (Issue #880, SR-158, SR-159).
 *
 * POST /api/agents                     - Register agent (admin approval)
 * GET  /api/agents/:id                 - Get agent profile (auth required; payout_address restricted to owner/admin)
 * PUT  /api/agents/:id/payout-address  - Update payout address (admin/agent-owner)
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { ErrorResponse } from '../types';
import { sanitizeInput } from '../utils/sanitize.js';
import { extractBearerToken, verifyAccessToken, requireAuth, ensureOwnership } from '../middleware/auth.js';

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

// ── AgentStore interface ──────────────────────────────────────────────────────

/**
 * Minimal interface that both the in-memory (test) store and the
 * Postgres-backed store implement.  Callers only see this interface,
 * making the swap invisible to route code.
 */
export interface AgentStore {
  getById(id: string): Promise<Agent | null>;
  create(agent: Agent): Promise<Agent>;
  updatePayoutAddress(id: string, payoutAddress: string, updatedAt: string): Promise<Agent | null>;
  exists(id: string): Promise<boolean>;
}

// ── In-memory implementation (used by tests) ─────────────────────────────────

export class InMemoryAgentStore implements AgentStore {
  private readonly data = new Map<string, Agent>();

  async getById(id: string): Promise<Agent | null> {
    return this.data.get(id) ?? null;
  }

  async create(agent: Agent): Promise<Agent> {
    this.data.set(agent.id, agent);
    return agent;
  }

  async updatePayoutAddress(id: string, payoutAddress: string, updatedAt: string): Promise<Agent | null> {
    const agent = this.data.get(id);
    if (!agent) return null;
    const updated = { ...agent, payout_address: payoutAddress, updated_at: updatedAt };
    this.data.set(id, updated);
    return updated;
  }

  async exists(id: string): Promise<boolean> {
    return this.data.has(id);
  }

  /** Test helper: wipe all records between test cases */
  clear(): void {
    this.data.clear();
  }
}

// ── Postgres implementation ───────────────────────────────────────────────────

/** DDL mirrors the REMITTANCE_SCHEMA_SQL pattern in db/remittanceStore.ts */
export const AGENT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS api_agents (
    id               VARCHAR(56)  PRIMARY KEY,
    stellar_address  VARCHAR(56)  NOT NULL UNIQUE,
    payout_address   TEXT         NOT NULL,
    name             VARCHAR(255) NOT NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_api_agents_stellar_address ON api_agents(stellar_address);
`;

type AgentRow = {
  id: string;
  stellar_address: string;
  payout_address: string;
  name: string;
  status: 'pending' | 'active' | 'suspended';
  created_at: Date | string;
  updated_at: Date | string;
};

function mapRow(row: AgentRow): Agent {
  return {
    id: row.id,
    stellar_address: row.stellar_address,
    payout_address: row.payout_address,
    name: row.name,
    status: row.status,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export class PostgresAgentStore implements AgentStore {
  constructor(private readonly pool: Pool) {}

  async initializeSchema(): Promise<void> {
    await this.pool.query(AGENT_SCHEMA_SQL);
  }

  async getById(id: string): Promise<Agent | null> {
    const result = await this.pool.query<AgentRow>(
      `SELECT id, stellar_address, payout_address, name, status, created_at, updated_at
         FROM api_agents
        WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async create(agent: Agent): Promise<Agent> {
    const result = await this.pool.query<AgentRow>(
      `INSERT INTO api_agents (id, stellar_address, payout_address, name, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, stellar_address, payout_address, name, status, created_at, updated_at`,
      [
        agent.id,
        agent.stellar_address,
        agent.payout_address,
        agent.name,
        agent.status,
        agent.created_at,
        agent.updated_at,
      ],
    );
    return mapRow(result.rows[0]);
  }

  async updatePayoutAddress(id: string, payoutAddress: string, updatedAt: string): Promise<Agent | null> {
    const result = await this.pool.query<AgentRow>(
      `UPDATE api_agents
            SET payout_address = $1, updated_at = $2
          WHERE id = $3
          RETURNING id, stellar_address, payout_address, name, status, created_at, updated_at`,
      [payoutAddress, updatedAt, id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async exists(id: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM api_agents WHERE id = $1) AS exists`,
      [id],
    );
    return result.rows[0]?.exists ?? false;
  }
}

// ── Router options ────────────────────────────────────────────────────────────

export interface AgentsRouterOptions {
  /**
   * Backing store for agent records.
   * - Tests inject an `InMemoryAgentStore`.
   * - Production (`createApp`) injects a `PostgresAgentStore`.
   * - When omitted the router falls back to an `InMemoryAgentStore`
   *   (backward-compatible with tests that import `createAgentsRouter()`
   *   without options).
   */
  store?: AgentStore;
}

// ── Singleton default store (tests that import `agentStore` directly) ─────────

/**
 * @deprecated
 * Legacy export kept so existing test files that reference `agentStore`
 * directly (e.g. `agentStore.clear()`) continue to compile.
 * New code should inject a store via `AgentsRouterOptions`.
 * The default router factory (`createAgentsRouter()` with no arguments)
 * uses this instance as well, so tests that do `beforeEach(() => agentStore.clear())`
 * still work without modification.
 */
export const agentStore: InMemoryAgentStore = new InMemoryAgentStore();

// ── Router factory ────────────────────────────────────────────────────────────

export function createAgentsRouter(options: AgentsRouterOptions = {}): Router {
  const store: AgentStore = options.store ?? agentStore;
  const router = Router();

  /**
   * POST /api/agents
   * Register a new agent. Requires admin API key or admin/agent JWT.
   * Sets status to 'pending' until on-chain registration is confirmed.
   */
  router.post('/', async (req: Request, res: Response) => {
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

    try {
      if (await store.exists(stellar_address)) {
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
      const created = await store.create(agent);
      return res.status(201).json({ success: true, data: created, timestamp: timestamp() });
    } catch (err) {
      return sendError(
        res,
        500,
        err instanceof Error ? err.message : 'Failed to register agent',
        'STORE_ERROR',
      );
    }
  });

  /**
   * GET /api/agents/:id
   *
   * Retrieve an agent profile by stellar_address.
   *
   * SR-158: Requires authentication.
   * - Admins receive the full record including `payout_address`.
   * - The agent themselves (userId === agent.id) also receive `payout_address`.
   * - Any other authenticated caller receives only public fields
   *   (id, stellar_address, name, status, created_at, updated_at).
   */
  router.get('/:id', requireAuth, async (req: Request<{ id: string }>, res: Response) => {
    try {
      const agent = await store.getById(req.params.id);
      if (!agent) {
        return sendError(res, 404, 'Agent not found', 'AGENT_NOT_FOUND');
      }

      const auth = req.auth!;
      const isSelf = auth.userId === agent.id;
      const isAdmin = auth.role === 'admin';

      if (isSelf || isAdmin) {
        // Full record — owner or admin
        return res.json({ success: true, data: agent, timestamp: timestamp() });
      }

      // Other authenticated callers: strip payout_address to avoid leaking
      // settlement-fund target addresses to third parties.
      const { payout_address: _stripped, ...publicFields } = agent;
      return res.json({ success: true, data: publicFields, timestamp: timestamp() });
    } catch (err) {
      return sendError(
        res,
        500,
        err instanceof Error ? err.message : 'Failed to retrieve agent',
        'STORE_ERROR',
      );
    }
  });

  /**
   * PUT /api/agents/:id/payout-address
   * Update the payout address for an agent. Requires admin API key or admin/agent JWT.
   */
  router.put('/:id/payout-address', async (req: Request<{ id: string }>, res: Response) => {
    if (!isAdminAuthorized(req)) {
      return sendError(res, 401, 'Admin authentication required', 'UNAUTHORIZED');
    }

    try {
      const agent = await store.getById(req.params.id);
      if (!agent) {
        return sendError(res, 404, 'Agent not found', 'AGENT_NOT_FOUND');
      }

      const { payout_address } = req.body as Record<string, unknown>;
      if (typeof payout_address !== 'string' || payout_address.trim().length === 0) {
        return sendError(res, 400, 'payout_address is required', 'MISSING_FIELD');
      }

      const now = timestamp();
      const updated = await store.updatePayoutAddress(
        agent.id,
        sanitizeInput(payout_address.trim()),
        now,
      );
      if (!updated) {
        return sendError(res, 404, 'Agent not found', 'AGENT_NOT_FOUND');
      }
      return res.json({ success: true, data: updated, timestamp: timestamp() });
    } catch (err) {
      return sendError(
        res,
        500,
        err instanceof Error ? err.message : 'Failed to update payout address',
        'STORE_ERROR',
      );
    }
  });

  return router;
}
