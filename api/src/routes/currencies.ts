import { Router, Request, Response } from 'express';
import { getCurrencyConfigLoader } from '../config';
import { CurrencyResponse, ErrorResponse } from '../types';

const router = Router();

// Reject requests where the path is just a trailing slash with no code
// e.g. GET /api/currencies/ should not match the list route
router.use((req: Request, res: Response, next: Function) => {
  // If the original URL ends with /currencies/ (trailing slash), treat as not found
  if (req.method === 'GET' && req.originalUrl.endsWith('/currencies/')) {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        message: `Route not found: ${req.method} ${req.path}`,
        code: 'ROUTE_NOT_FOUND',
      },
      timestamp: new Date().toISOString(),
    };
    return res.status(404).json(errorResponse);
  }
  next();
});

/**
 * GET /api/currencies
 * Returns supported currencies with their formatting rules
 * Query parameters:
 *   - limit: Number of currencies to return (default: 50, max: 500)
 *   - offset: Number of currencies to skip (default: 0)
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const configLoader = getCurrencyConfigLoader();
    const allCurrencies = configLoader.getCurrencies();

    // Parse and validate pagination parameters
    let limit = 50;
    let offset = 0;

    if (req.query.limit) {
      const parsedLimit = parseInt(req.query.limit as string, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: {
            message: 'Invalid limit parameter: must be a positive integer',
            code: 'INVALID_PAGINATION_PARAM',
          },
          timestamp: new Date().toISOString(),
        };
        return res.status(400).json(errorResponse);
      }
      limit = Math.min(parsedLimit, 500); // Cap at 500
    }

    if (req.query.offset) {
      const parsedOffset = parseInt(req.query.offset as string, 10);
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: {
            message: 'Invalid offset parameter: must be a non-negative integer',
            code: 'INVALID_PAGINATION_PARAM',
          },
          timestamp: new Date().toISOString(),
        };
        return res.status(400).json(errorResponse);
      }
      offset = parsedOffset;
    }

    // Apply pagination
    const paginatedCurrencies = allCurrencies.slice(offset, offset + limit);

    const response: CurrencyResponse = {
      success: true,
      data: paginatedCurrencies,
      count: paginatedCurrencies.length,
      total: allCurrencies.length,
      limit,
      offset,
      timestamp: new Date().toISOString(),
    };

    res.json(response);
  } catch (error) {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to retrieve currencies',
        code: 'CURRENCY_RETRIEVAL_ERROR',
      },
      timestamp: new Date().toISOString(),
    };

    res.status(500).json(errorResponse);
  }
});

/**
 * GET /api/currencies/:code
 * Returns a specific currency by code
 */
router.get('/:code', (req: Request, res: Response) => {
  try {
    const { code } = req.params;

    if (!code || typeof code !== 'string' || code.trim() === '') {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          message: 'Currency code is required',
          code: 'INVALID_CURRENCY_CODE',
        },
        timestamp: new Date().toISOString(),
      };
      return res.status(400).json(errorResponse);
    }

    // Validate code format: must be uppercase letters/numbers, 1-12 chars
    if (!/^[A-Za-z0-9]{1,12}$/.test(code) || code.length > 12) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          message: `Invalid currency code format: ${code}`,
          code: 'INVALID_CURRENCY_CODE',
        },
        timestamp: new Date().toISOString(),
      };
      return res.status(400).json(errorResponse);
    }

    const configLoader = getCurrencyConfigLoader();
    const currency = configLoader.getCurrencyByCode(code);

    if (!currency) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          message: `Currency not found: ${code.toUpperCase()}`,
          code: 'CURRENCY_NOT_FOUND',
        },
        timestamp: new Date().toISOString(),
      };
      return res.status(404).json(errorResponse);
    }

    const response: CurrencyResponse = {
      success: true,
      data: [currency],
      count: 1,
      timestamp: new Date().toISOString(),
    };

    res.json(response);
  } catch (error) {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to retrieve currency',
        code: 'CURRENCY_RETRIEVAL_ERROR',
      },
      timestamp: new Date().toISOString(),
    };

    res.status(500).json(errorResponse);
  }
});

export default router;
