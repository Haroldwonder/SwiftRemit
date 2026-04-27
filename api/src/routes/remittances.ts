/**
 * Remittance routes.
 *
 * PATCH /api/remittances/:id/status
 *   Transitions a remittance to a new status and pushes a `status:updated`
 *   WebSocket event to all clients watching `remittance:{id}`.
 *
 * GET /api/remittances/:id
 *   Returns the current state of a remittance.
 */

import { Router, Request, Response } from 'express';
import { ErrorResponse } from '../types';
import { RemittanceService, InvalidTransitionError, RemittanceNotFoundError } from '../services/remittanceService';
import { RemittanceStatus } from '../websocket/types';

const VALID_STATUSES: RemittanceStatus[] = [
  'Pending',
  'Processing',
  'Completed',
  'Cancelled',
  'Failed',
  'Disputed',
];

function isRemittanceStatus(value: unknown): value is RemittanceStatus {
  return typeof value === 'string' && (VALID_STATUSES as string[]).includes(value);
}

function timestamp(): string {
  return new Date().toISOString();
}

function sendError(
  res: Response,
  httpStatus: number,
  message: string,
  code: string,
): Response {
  const body: ErrorResponse = {
    success: false,
    error: { message, code },
    timestamp: timestamp(),
  };
  return res.status(httpStatus).json(body);
}

export type RemittancesRouterOptions = {
  service?: RemittanceService;
};

export function createRemittancesRouter(options: RemittancesRouterOptions = {}): Router {
  const router = Router();

  function getService(): RemittanceService {
    if (options.service) return options.service;
    // Lazy-load the default service so tests can inject their own
    const { getDefaultRemittanceService } = require('../services/remittanceService');
    return getDefaultRemittanceService();
  }

  /**
   * GET /api/remittances/:id
   * Returns the current remittance record.
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const remittance = await getService().getById(req.params.id);

      if (!remittance) {
        return sendError(res, 404, `Remittance '${req.params.id}' not found`, 'REMITTANCE_NOT_FOUND');
      }

      return res.json({
        success: true,
        data: remittance,
        timestamp: timestamp(),
      });
    } catch (err) {
      return sendError(
        res,
        500,
        err instanceof Error ? err.message : 'Failed to retrieve remittance',
        'REMITTANCE_RETRIEVAL_ERROR',
      );
    }
  });

  /**
   * PATCH /api/remittances/:id/status
   *
   * Body: { "status": "Processing" }
   *
   * Transitions the remittance to the requested status, persists it, and
   * emits a `status:updated` WebSocket event to the remittance's room.
   *
   * Responses:
   *   200  – transition succeeded; returns updated remittance
   *   400  – missing/invalid status value or invalid state transition
   *   404  – remittance not found
   *   500  – unexpected error
   */
  router.patch('/:id/status', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body as { status?: unknown };

    if (!isRemittanceStatus(status)) {
      return sendError(
        res,
        400,
        `'status' must be one of: ${VALID_STATUSES.join(', ')}`,
        'INVALID_STATUS',
      );
    }

    try {
      const updated = await getService().updateStatus(id, status);

      return res.json({
        success: true,
        data: updated,
        timestamp: timestamp(),
      });
    } catch (err) {
      if (err instanceof RemittanceNotFoundError) {
        return sendError(res, 404, err.message, 'REMITTANCE_NOT_FOUND');
      }
      if (err instanceof InvalidTransitionError) {
        return sendError(res, 400, err.message, 'INVALID_TRANSITION');
      }
      return sendError(
        res,
        500,
        err instanceof Error ? err.message : 'Failed to update remittance status',
        'REMITTANCE_UPDATE_ERROR',
      );
    }
  });

  return router;
}
