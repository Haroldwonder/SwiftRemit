/**
 * GET /api/remittances
 *
 * Query remittances by agent address with cursor-based pagination.
 * Resolves issues #472 and #531.
 *
 * Query parameters:
 *   agent  {string}  - Stellar address of the agent (optional)
 *   status {string}  - Filter by status: Pending | Processing | Completed | Cancelled (optional)
 *   cursor {string}  - Opaque pagination cursor from previous response (optional)
 *   limit  {number}  - Items per page, max 100 (default: 20)
 *
 * Response includes:
 *   - data: Array of remittance objects
 *   - next_cursor: Opaque token for fetching the next page (null if no more results)
 *   - has_more: Boolean indicating if more results exist
 *
 * The `memo` field is included in each remittance object when present (issue #538).
 */

import { Router, Request, Response } from 'express';
import { ErrorResponse } from '../types';
import { RemittanceStore } from '../db/remittanceStore';
import { createRemittanceSchema, validateRequest } from './schemas/requestValidation';

export type RemittanceStatus = 'Pending' | 'Processing' | 'Completed' | 'Cancelled' | 'Failed' | 'Disputed';

export interface Remittance {
  id: number;
  sender: string;
  agent: string;
  amount: number;
  fee: number;
  status: RemittanceStatus;
  token?: string;
  memo?: string;
  created_at: string;
  updated_at: string;
}

const VALID_STATUSES: RemittanceStatus[] = ['Pending', 'Processing', 'Completed', 'Cancelled', 'Failed', 'Disputed'];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export type RemittancesRouterOptions = {
  remittanceStore?: RemittanceStore;
};

function timestamp(): string {
  return new Date().toISOString();
}

function sendError(res: Response, status: number, message: string, code: string): Response<ErrorResponse> {
  return res.status(status).json({ success: false, error: { message, code }, timestamp: timestamp() });
}

/**
 * Creates the remittances router with optional store injection for testing.
 */
export function createRemittancesRouter(options: RemittancesRouterOptions = {}): Router {
  const router = Router();
  const { remittanceStore } = options;

  /**
   * @openapi
   * /api/remittances:
   *   get:
   *     summary: Query remittances with cursor-based pagination
   *     description: >
   *       Returns a cursor-paginated list of remittances with optional agent and status filtering.
   *       Cursor pagination provides stable results even when new records are inserted.
   *     tags:
   *       - Remittances
   *     parameters:
   *       - name: agent
   *         in: query
   *         required: false
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
   *       - name: cursor
   *         in: query
   *         required: false
   *         description: Opaque pagination cursor from previous response
   *         schema:
   *           type: string
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
   *         description: Cursor-paginated list of remittances
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Remittance'
   *                 next_cursor:
   *                   type: string
   *                   nullable: true
   *                 has_more:
   *                   type: boolean
   *                 timestamp:
   *                   type: string
   *       400:
   *         description: Invalid query parameters
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.get('/', async (req: Request, res: Response) => {
    const { agent, status, cursor, limit: limitStr } = req.query as Record<string, string | undefined>;

    if (status !== undefined && !VALID_STATUSES.includes(status as RemittanceStatus)) {
      return sendError(
        res,
        400,
        `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
        'INVALID_STATUS',
      );
    }

    const limit = limitStr !== undefined ? parseInt(limitStr, 10) : DEFAULT_LIMIT;

    if (isNaN(limit) || limit < 1 || limit > MAX_LIMIT) {
      return sendError(res, 400, `\`limit\` must be between 1 and ${MAX_LIMIT}`, 'INVALID_LIMIT');
    }

    if (!remittanceStore) {
      return sendError(res, 503, 'Remittance store not configured', 'SERVICE_UNAVAILABLE');
    }

    try {
      const result = await remittanceStore.queryWithCursor(
        cursor || null,
        limit,
        agent?.trim(),
        status as RemittanceStatus | undefined,
      );

      return res.json({
        success: true,
        data: result.items,
        next_cursor: result.nextCursor,
        has_more: result.hasMore,
        timestamp: timestamp(),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid cursor')) {
        return sendError(res, 400, error.message, 'INVALID_CURSOR');
      }
      throw error;
    }
  });

  return router;
}

// Default export for backward compatibility
export default createRemittancesRouter();
