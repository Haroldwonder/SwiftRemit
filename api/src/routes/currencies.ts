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
 * Returns all supported currencies with their formatting rules
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const configLoader = getCurrencyConfigLoader();
    const currencies = configLoader.getCurrencies();

    const response: CurrencyResponse = {
      success: true,
      data: currencies,
      count: currencies.length,
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
