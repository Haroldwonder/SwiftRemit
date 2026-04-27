import { Router, Request, Response } from 'express';
import { AnchorProvider, AnchorListResponse, AnchorDetailResponse } from '../types/anchor';
import { ErrorResponse } from '../types';
import {
  AnchorStore,
  getDefaultAnchorStore,
  isAnchorStatus,
} from '../db/anchorStore';

type RouterOptions = {
  store?: AnchorStore;
  adminApiKey?: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isAnchorProvider(value: unknown): value is AnchorProvider {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.domain === 'string' &&
    typeof value.description === 'string' &&
    typeof value.processing_time === 'string' &&
    typeof value.verified === 'boolean' &&
    typeof value.status === 'string' &&
    isAnchorStatus(value.status) &&
    isRecord(value.fees) &&
    isRecord(value.limits) &&
    isRecord(value.compliance) &&
    isStringArray(value.supported_currencies)
  );
}

function isAnchorUpdatePayload(value: unknown): value is Partial<AnchorProvider> {
  if (!isRecord(value)) {
    return false;
  }

  const status = value.status;
  if (status !== undefined && (typeof status !== 'string' || !isAnchorStatus(status))) {
    return false;
  }

  const supportedCurrencies = value.supported_currencies;
  if (supportedCurrencies !== undefined && !isStringArray(supportedCurrencies)) {
    return false;
  }

  return true;
}

function requireAdminApiKey(adminApiKey?: string) {
  return (req: Request, res: Response, next: () => void): void | Response<ErrorResponse> => {
    if (!adminApiKey) {
      return sendError(
        res,
        500,
        'Anchor admin API key is not configured',
        'ANCHOR_ADMIN_NOT_CONFIGURED',
      );
    }

    const requestApiKey = req.header('x-api-key');
    if (!requestApiKey || requestApiKey !== adminApiKey) {
      return sendError(res, 401, 'Unauthorized', 'UNAUTHORIZED');
    }

    next();
  };
}

export function createAnchorsRouter(options: RouterOptions = {}): Router {
  const router = Router();
  const adminAuth = requireAdminApiKey(
    options.adminApiKey ?? process.env.ANCHORS_ADMIN_API_KEY,
  );
  const getStore = (): AnchorStore => options.store ?? getDefaultAnchorStore();

/**
 * GET /api/anchors
 * Returns all available anchor providers
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, currency } = req.query;

    // Accept currencies[] (multi) or currency (single, backward-compat)
    const rawCurrencies = req.query['currencies[]'];
    const currencies: string[] | undefined = rawCurrencies
      ? (Array.isArray(rawCurrencies) ? rawCurrencies : [rawCurrencies]).filter(
          (c): c is string => typeof c === 'string',
        )
      : undefined;

    const filteredAnchors = await getStore().list({
      status: typeof status === 'string' ? status : undefined,
      currency: typeof currency === 'string' ? currency : undefined,
      currencies,
    });

    const response: AnchorListResponse = {
      success: true,
      data: filteredAnchors,
      count: filteredAnchors.length,
      timestamp: timestamp(),
    };

    res.json(response);
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to retrieve anchors',
      'ANCHOR_RETRIEVAL_ERROR',
    );
  }
});

router.post('/admin', adminAuth, async (req: Request, res: Response) => {
  try {
    if (!isAnchorProvider(req.body)) {
      return sendError(res, 400, 'Invalid anchor payload', 'INVALID_ANCHOR_PAYLOAD');
    }

    const anchor = await getStore().create(req.body);
    const response: AnchorDetailResponse = {
      success: true,
      data: anchor,
      timestamp: timestamp(),
    };

    res.status(201).json(response);
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to create anchor',
      'ANCHOR_CREATE_ERROR',
    );
  }
});

router.put('/admin/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    if (!isAnchorUpdatePayload(req.body)) {
      return sendError(res, 400, 'Invalid anchor update payload', 'INVALID_ANCHOR_PAYLOAD');
    }

    const anchor = await getStore().update(req.params.id, req.body);
    if (!anchor) {
      return sendError(
        res,
        404,
        `Anchor with id '${req.params.id}' not found`,
        'ANCHOR_NOT_FOUND',
      );
    }

    const response: AnchorDetailResponse = {
      success: true,
      data: anchor,
      timestamp: timestamp(),
    };

    res.json(response);
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to update anchor',
      'ANCHOR_UPDATE_ERROR',
    );
  }
});

router.post('/admin/:id/deactivate', adminAuth, async (req: Request, res: Response) => {
  try {
    const anchor = await getStore().deactivate(req.params.id);
    if (!anchor) {
      return sendError(
        res,
        404,
        `Anchor with id '${req.params.id}' not found`,
        'ANCHOR_NOT_FOUND',
      );
    }

    const response: AnchorDetailResponse = {
      success: true,
      data: anchor,
      timestamp: timestamp(),
    };

    res.json(response);
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to deactivate anchor',
      'ANCHOR_DEACTIVATE_ERROR',
    );
  }
});

router.delete('/admin/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await getStore().delete(req.params.id);
    if (!deleted) {
      return sendError(
        res,
        404,
        `Anchor with id '${req.params.id}' not found`,
        'ANCHOR_NOT_FOUND',
      );
    }

    res.json({
      success: true,
      data: { id: req.params.id },
      timestamp: timestamp(),
    });
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to delete anchor',
      'ANCHOR_DELETE_ERROR',
    );
  }
});

/**
 * GET /api/anchors/:id
 * Returns details for a specific anchor provider
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const anchor = await getStore().getById(id);

    if (!anchor) {
      return sendError(
        res,
        404,
        `Anchor with id '${id}' not found`,
        'ANCHOR_NOT_FOUND',
      );
    }

    const response: AnchorDetailResponse = {
      success: true,
      data: anchor,
      timestamp: timestamp(),
    };

    res.json(response);
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to retrieve anchor',
      'ANCHOR_RETRIEVAL_ERROR',
    );
  }
});

return router;
}
