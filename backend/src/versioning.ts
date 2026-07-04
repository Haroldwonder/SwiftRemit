import { Router, Request, Response, NextFunction } from 'express';

/**
 * API versioning support with redirect fallback for root-level routes.
 * New routes should use /api/v1 or /api/v2 prefixes.
 * During transition, root /api routes return 301 redirects to /api/v1.
 */

export const API_VERSION = 'v1';

/** Middleware to handle legacy root-level /api routes and redirect to /api/v1 */
export function createLegacyRedirectMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    // Match /api/* but NOT /api/v1/* or /api/v2/*
    if (req.path.startsWith('/api/') && !/^\/api\/v\d+\//.test(req.path)) {
      // Remove the leading /api and add versioned prefix
      const pathWithoutApi = req.path.substring(4); // Remove "/api"
      const newPath = `/api/${API_VERSION}${pathWithoutApi}`;
      return res.redirect(301, newPath);
    }
    next();
  };
}

/**
 * Create an Express router mounted at a versioned path.
 * Returns a router that's ready to be mounted at e.g. app.use('/api/v1', versionedRouter).
 */
export function createVersionedRouter(): Router {
  return Router();
}

/** Get current API version from request headers (X-API-Version header) or use default */
export function getApiVersion(req: Request): string {
  const headerVersion = req.headers['x-api-version'] as string | undefined;
  if (headerVersion && /^v\d+$/.test(headerVersion)) {
    return headerVersion;
  }
  return API_VERSION;
}

/** Add deprecation header for endpoints scheduled for removal */
export function addDeprecationHeader(
  res: Response,
  deprecatedAt: Date,
  sunsetDate: Date,
  migrationUrl?: string
): void {
  const rfc7231Date = sunsetDate.toUTCString();
  res.set('Sunset', rfc7231Date);
  res.set('Deprecation', 'true');
  
  if (migrationUrl) {
    res.set('Link', `<${migrationUrl}>; rel="deprecation"`);
  }
}
