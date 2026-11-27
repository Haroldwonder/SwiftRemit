import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { getCurrencyConfigLoader, getCurrencyCacheMaxAge } from '../config';
import { getConversionRateService } from '../services/conversionRates';
import { CurrencyResponse, ErrorResponse } from '../types';
import { sendInternalError } from '../middleware/errorHandler';

const router = Router();

/**
 * #1878 — Build a strong, content-derived ETag for a response payload.
 * The payload is serialised with sorted keys so the digest is stable.
 */
function buildStrongETag(payload: unknown): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('base64url');
  return `"${digest}"`;
}

/**
 * #1878 — Send a cacheable JSON response with `Cache-Control` and a strong
 * `ETag`, answering `304 Not Modified` when `If-None-Match` matches.
 */
function sendCacheableJson(req: Request, res: Response, payload: unknown): Response {
  const etag = buildStrongETag(payload);
  res.setHeader('Cache-Control', `public, max-age=${getCurrencyCacheMaxAge()}`);
  res.setHeader('ETag', etag);

  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch) {
    const candidates = String(ifNoneMatch)
      .split(',')
      .map(tag => tag.trim().replace(/^W\//, ''));
    if (candidates.includes(etag) || candidates.includes('*')) {
      return res.status(304).end();
    }
  }

  return res.json(payload);
}

// Reject requests where the path is just a trailing slash with no code
// e.g. GET /api/currencies/ should not match the list route
router.use((req: Request, res: Response, next: Function) => {
  // If the original URL ends with /currencies/ (trailing slash), treat as not found
  if (req.method === 'GET' && req.originalUrl.endsWith('/currencies/')) {
    return sendError(res, 404, `Route not found: ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND');
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
        return sendError(res, 400, 'Invalid limit parameter: must be a positive integer', 'INVALID_PAGINATION_PARAM');
      }
      limit = Math.min(parsedLimit, 500); // Cap at 500
    }

    if (req.query.offset) {
      const parsedOffset = parseInt(req.query.offset as string, 10);
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        return sendError(res, 400, 'Invalid offset parameter: must be a non-negative integer', 'INVALID_PAGINATION_PARAM');
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
      config_loaded_at: configLoader.getLoadedAt(),
      timestamp: new Date().toISOString(),
    };

    return sendCacheableJson(req, res, response);
  } catch (error) {
    return sendInternalError(req, res, error, 'CURRENCY_RETRIEVAL_ERROR');
  }
});

/**
 * GET /api/currencies/:code
 * Returns a specific currency by code or alias (#1547).
 *
 * The `:code` segment is matched first against canonical codes (e.g. "USD"),
 * then against any registered aliases (e.g. "DOLLAR", "dollars").  Both
 * lookups are case-insensitive.
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
    // #1547: resolve by canonical code first, then by alias
    const currency = configLoader.getCurrencyByCodeOrAlias(code);

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
      config_loaded_at: configLoader.getLoadedAt(),
      timestamp: new Date().toISOString(),
    };

    return sendCacheableJson(req, res, response);
  } catch (error) {
    return sendInternalError(req, res, error, 'CURRENCY_RETRIEVAL_ERROR');
  }
});

/**
 * GET /api/currencies/:from/rates/:to
 * Returns the current exchange rate from one currency to another (#1545).
 *
 * Both `:from` and `:to` support canonical codes and aliases (e.g. "DOLLAR").
 * Rates are cached for 5 minutes.  The response includes a `fetched_at`
 * timestamp so callers can detect how fresh the rate is.
 *
 * Example:
 *   GET /api/currencies/USD/rates/EUR
 *   GET /api/currencies/DOLLAR/rates/NGN
 *
 * Response:
 *   {
 *     "success": true,
 *     "data": { "from": "USD", "to": "EUR", "rate": 0.92, "fetched_at": "..." },
 *     "timestamp": "..."
 *   }
 */
router.get('/:from/rates/:to', async (req: Request, res: Response) => {
  try {
    const { from: rawFrom, to: rawTo } = req.params as { from: string; to: string };

    // Validate both codes/aliases — same format rule as the single-currency lookup
    for (const [label, value] of [['from', rawFrom], ['to', rawTo]] as const) {
      if (!value || !/^[A-Za-z0-9 _-]{1,50}$/.test(value)) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: {
            message: `Invalid currency ${label} parameter: ${value}`,
            code: 'INVALID_CURRENCY_CODE',
          },
          timestamp: new Date().toISOString(),
        };
        return res.status(400).json(errorResponse);
      }
    }

    const configLoader = getCurrencyConfigLoader();

    // Resolve aliases → canonical codes
    const fromCurrency = configLoader.getCurrencyByCodeOrAlias(rawFrom);
    const toCurrency   = configLoader.getCurrencyByCodeOrAlias(rawTo);

    if (!fromCurrency) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          message: `Currency not found: ${rawFrom.toUpperCase()}`,
          code: 'CURRENCY_NOT_FOUND',
        },
        timestamp: new Date().toISOString(),
      };
      return res.status(404).json(errorResponse);
    }

    if (!toCurrency) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          message: `Currency not found: ${rawTo.toUpperCase()}`,
          code: 'CURRENCY_NOT_FOUND',
        },
        timestamp: new Date().toISOString(),
      };
      return res.status(404).json(errorResponse);
    }

    // #1876 — identical codes after alias resolution: no provider call needed
    const conversionRate =
      fromCurrency.code === toCurrency.code
        ? {
            from: fromCurrency.code,
            to: toCurrency.code,
            rate: 1,
            fetched_at: new Date().toISOString(),
            provider: 'identity',
          }
        : await getConversionRateService().getRate(fromCurrency.code, toCurrency.code);

    res.json({
      success: true,
      data: conversionRate,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return sendInternalError(req, res, error, 'CONVERSION_RATE_ERROR');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1553 — Currency validation endpoint (implementation plan)
// ─────────────────────────────────────────────────────────────────────────────
//
// POST /api/currencies/validate
//   Uses POST, not GET /validate/:code, so it can never collide with the
//   GET /:code route above. The request body can also carry an amount.
//
//   Request body (Joi schema added to src/schemas/requestValidation.ts):
//     { code: string (1-12 chars, [A-Za-z0-9]), amount?: string }
//   `amount` is a decimal *string* ("10.50"), never a JS number, so precision
//   is checked on exactly what the client sent, with no float rounding.
//
//   200 response. It is always 200 when the request is well-formed, because
//   "not supported" is a validation result, not a client error:
//     {
//       success: true,
//       data: {
//         code: "USD",                 // normalised to upper case
//         valid: boolean,              // true only if every check below passed
//         supported: boolean,          // code exists in the currency config
//         currency?: Currency,         // present when supported
//         amount?: {
//           valid: boolean,
//           decimal_places: number,
//           max_decimal_places: number // currency.decimal_precision
//         },
//         errors: Array<{ field: 'code' | 'amount', code: string, message: string }>
//       },
//       timestamp: string
//     }
//   Error codes in `errors`: CURRENCY_NOT_SUPPORTED, AMOUNT_NOT_NUMERIC,
//   AMOUNT_NOT_POSITIVE, AMOUNT_PRECISION_EXCEEDED.
//   400 (ErrorResponse, code INVALID_REQUEST_BODY) only when the body fails
//   Joi validation (missing code, wrong types, oversized strings).
//
//   Implementation:
//   - A pure helper `validateCurrencyInput(code, amount?, loader)` in a new
//     src/services/currencyValidation.ts, so the bulk endpoint (#1554), the
//     GraphQL resolvers and future callers share one definition. The code
//     format regex is the one already used by GET /:code above; move it into
//     the helper so the two can't drift.
//   - Amount check: /^\d+(\.\d+)?$/ on the string, then
//     decimal_places <= currency.decimal_precision, then > 0.
//   - Covered by the existing global rate limiter; no auth (public, like
//     the other currency routes).
//
//   Docs and tests:
//   - Add the path to src/schemas/openapi.ts so openapi-validation.test.ts
//     covers it.
//   - Tick "Currency validation endpoint" under Future Enhancements in
//     docs/implementation/CURRENCY_API.md and add a usage section there.
//   - New src/__tests__/currencies-validate.test.ts (supertest): supported
//     code; lower-case code normalised; unsupported code -> 200 with
//     valid=false; amount with too many decimals for a 2-dp currency;
//     amount "abc"; amount "0"; missing code -> 400; code with symbols -> 400.
//
// ─────────────────────────────────────────────────────────────────────────────
// Issue #1554 — Bulk currency operations (implementation plan)
// ─────────────────────────────────────────────────────────────────────────────
//
// Scope note: currencies are read-only here. They are loaded from the config
// file by CurrencyConfigLoader and there are no create/update/delete routes.
// Bulk *write* operations depend on "Admin API for currency management",
// which is a separate Future Enhancements item, so this issue covers bulk
// *read* operations. Bulk writes are designed to slot in later behind
// `requireAdmin` using the same request/response shape.
//
// POST /api/currencies/bulk
//   Body: { codes: string[] }  (1-100 items; each 1-12 chars [A-Za-z0-9])
//   - Codes are upper-cased and de-duplicated, and response order follows
//     first appearance in the request.
//   - 200: { success: true, data: Currency[], not_found: string[],
//            count: number, timestamp }
//   - 400 INVALID_REQUEST_BODY for an empty array, more than 100 items, or
//     any malformed code. The whole request is rejected so a client bug
//     can't silently drop codes.
//   - One getCurrencies() call, indexed into a Map by code, so lookup is
//     O(n) rather than calling getCurrencyByCode per item.
//
// POST /api/currencies/validate/bulk
//   Body: { items: Array<{ code: string, amount?: string }> } (1-100 items)
//   - Runs validateCurrencyInput (#1553) on each item. The response is
//     { success: true, data: ValidationResult[], all_valid: boolean,
//       timestamp }, with results in request order.
//   - Registered before any future `/validate/:x` style route.
//
// Shared:
//   - The 100-item cap is a named constant (MAX_BULK_CURRENCY_ITEMS) and the
//     body size is still bounded by the app's express.json limit.
//   - Both paths go in openapi.ts and CURRENCY_API.md, and "Bulk currency
//     operations" gets ticked.
//   - Tests (src/__tests__/currencies-bulk.test.ts): mixed found/not-found;
//     duplicates and case variants collapsed; 101 items -> 400; empty -> 400;
//     one malformed code -> 400; bulk validate returns per-item results and
//     all_valid=false when any item fails.

export default router;
