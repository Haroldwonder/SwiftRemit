/**
 * GET /api/remittances
 *
 * Query remittances with cursor-based pagination and filtering (Issues #472, #531, #882).
 *
 * Query parameters:
 *   agent       {string}  - Stellar address of the agent (optional)
 *   status      {string}  - Filter by status (optional)
 *   from_date   {string}  - ISO date lower bound for created_at (optional)
 *   to_date     {string}  - ISO date upper bound for created_at (optional)
 *   corridor    {string}  - Filter by corridor, format "USD-NG" (optional)
 *   min_amount  {number}  - Minimum amount in stroops (optional)
 *   max_amount  {number}  - Maximum amount in stroops (optional)
 *   cursor      {string}  - Opaque pagination cursor from previous response (optional)
 *   limit       {number}  - Items per page, max 100 (default: 20)
 */

import { Router, Request, Response } from 'express';
import { ErrorResponse } from '../types';
import { RemittanceStore } from '../db/remittanceStore';
import { createRemittanceSchema, validateRequest } from '../schemas/requestValidation';

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

export interface RemittanceFilter {
  agentId?: string;
  status?: RemittanceStatus;
  fromDate?: Date;
  toDate?: Date;
  corridor?: string;
  minAmount?: number;
  maxAmount?: number;
}

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
    const {
      agent,
      status,
      cursor,
      limit: limitStr,
      from_date,
      to_date,
      corridor,
      min_amount,
      max_amount,
    } = req.query as Record<string, string | undefined>;

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

    let fromDate: Date | undefined;
    let toDate: Date | undefined;
    if (from_date !== undefined) {
      fromDate = new Date(from_date);
      if (isNaN(fromDate.getTime())) {
        return sendError(res, 400, '`from_date` must be a valid ISO 8601 date', 'INVALID_DATE');
      }
    }
    if (to_date !== undefined) {
      toDate = new Date(to_date);
      if (isNaN(toDate.getTime())) {
        return sendError(res, 400, '`to_date` must be a valid ISO 8601 date', 'INVALID_DATE');
      }
    }

    let minAmount: number | undefined;
    let maxAmount: number | undefined;
    if (min_amount !== undefined) {
      minAmount = Number(min_amount);
      if (!Number.isFinite(minAmount) || minAmount < 0) {
        return sendError(res, 400, '`min_amount` must be a non-negative number', 'INVALID_AMOUNT');
      }
    }
    if (max_amount !== undefined) {
      maxAmount = Number(max_amount);
      if (!Number.isFinite(maxAmount) || maxAmount < 0) {
        return sendError(res, 400, '`max_amount` must be a non-negative number', 'INVALID_AMOUNT');
      }
    }
    if (minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount) {
      return sendError(res, 400, '`min_amount` must not exceed `max_amount`', 'INVALID_AMOUNT_RANGE');
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
        fromDate,
        toDate,
        corridor?.trim(),
        minAmount,
        maxAmount,
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
