/**
 * GET /api/remittances
 *
 * Query remittances by agent address with optional status filter and pagination.
 * Resolves issue #472.
 *
 * Query parameters:
 *   agent  {string}  - Stellar address of the agent (required)
 *   status {string}  - Filter by status: Pending | Processing | Completed | Cancelled (optional)
 *   page   {number}  - 1-based page number (default: 1)
 *   limit  {number}  - Items per page, max 100 (default: 20)
 *
 * The `memo` field is included in each remittance object when present (issue #538).
 */

import { Router, Request, Response } from 'express';
import { ErrorResponse } from '../types';

export type RemittanceStatus = 'Pending' | 'Processing' | 'Completed' | 'Cancelled' | 'Failed' | 'Disputed';

export interface Remittance {
  id: number;
  sender: string;
  agent: string;
  amount: number;
  fee: number;
  status: RemittanceStatus;
  memo?: string;
  created_at: string;
  updated_at: string;
}

const VALID_STATUSES: RemittanceStatus[] = ['Pending', 'Processing', 'Completed', 'Cancelled', 'Failed', 'Disputed'];
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

function timestamp(): string {
  return new Date().toISOString();
}

function sendError(res: Response, status: number, message: string, code: string): Response<ErrorResponse> {
  return res.status(status).json({ success: false, error: { message, code }, timestamp: timestamp() });
}

/**
 * Stub data source — in production this would query the contract via RPC
 * or a database populated by the event listener.
 */
function fetchRemittancesByAgent(
  agent: string,
  status?: RemittanceStatus,
  page = 1,
  limit = DEFAULT_PAGE_LIMIT,
): { items: Remittance[]; total: number } {
  // Placeholder: real implementation queries contract/DB
  const items: Remittance[] = [];
  return { items, total: 0 };
}

const router = Router();

/**
 * @openapi
 * /api/remittances:
 *   get:
 *     summary: Query remittances by agent address
 *     description: >
 *       Returns a paginated list of remittances assigned to the given agent,
 *       with optional status filtering.
 *     tags:
 *       - Remittances
 *     parameters:
 *       - name: agent
 *         in: query
 *         required: true
 *         description: Stellar address of the agent
 *         schema:
 *           type: string
 *       - name: status
 *         in: query
 *         required: false
 *         description: Filter by remittance status
 *         schema:
 *           type: string
 *           enum: [Pending, Processing, Completed, Cancelled, Failed, Disputed]
 *       - name: page
 *         in: query
 *         required: false
 *         description: 1-based page number
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - name: limit
 *         in: query
 *         required: false
 *         description: Items per page (max 100)
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated list of remittances
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RemittanceListResponse'
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/', (req: Request, res: Response) => {
  const { agent, status, page: pageStr, limit: limitStr } = req.query as Record<string, string | undefined>;

  if (!agent || typeof agent !== 'string' || agent.trim() === '') {
    return sendError(res, 400, '`agent` query parameter is required', 'MISSING_AGENT');
  }

  if (status !== undefined && !VALID_STATUSES.includes(status as RemittanceStatus)) {
    return sendError(
      res,
      400,
      `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      'INVALID_STATUS',
    );
  }

  const page = pageStr !== undefined ? parseInt(pageStr, 10) : 1;
  const limit = limitStr !== undefined ? parseInt(limitStr, 10) : DEFAULT_PAGE_LIMIT;

  if (isNaN(page) || page < 1) {
    return sendError(res, 400, '`page` must be a positive integer', 'INVALID_PAGE');
  }
  if (isNaN(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    return sendError(res, 400, `\`limit\` must be between 1 and ${MAX_PAGE_LIMIT}`, 'INVALID_LIMIT');
  }

  const { items, total } = fetchRemittancesByAgent(
    agent.trim(),
    status as RemittanceStatus | undefined,
    page,
    limit,
  );

  return res.json({
    success: true,
    data: items,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
    timestamp: timestamp(),
  });
});

export default router;
