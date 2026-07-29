/**
 * API versioning middleware and deprecation headers.
 * SR-056
 *
 * Mounts all routes under /v1/ with aliases from unversioned paths.
 * Emits Deprecation and Sunset headers for deprecated endpoints.
 */
import { Router, Request, Response, NextFunction } from 'express';

export const CURRENT_VERSION = 'v1';
export const SUPPORT_WINDOW_MONTHS = 12;

export interface DeprecationEntry {
  path: string;
  deprecatedAt: string;   // ISO date
  sunsetAt: string;        // ISO date
  replacement?: string;
}

// Registry of deprecated endpoints
const deprecationRegistry: DeprecationEntry[] = [];

/**
 * Register a deprecated endpoint.
 */
export function registerDeprecation(entry: DeprecationEntry): void {
  deprecationRegistry.push(entry);
}

/**
 * Get all registered deprecations.
 */
export function getDeprecations(): DeprecationEntry[] {
  return [...deprecationRegistry];
}

/**
 * Middleware that adds Deprecation and Sunset headers for deprecated paths.
 */
export function deprecationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const entry = deprecationRegistry.find(d => req.path.startsWith(d.path));
  if (entry) {
    res.setHeader('Deprecation', `date="${entry.deprecatedAt}"`);
    res.setHeader('Sunset', entry.sunsetAt);
    if (entry.replacement) {
      res.setHeader('Link', `<${entry.replacement}>; rel="successor-version"`);
    }
  }
  next();
}

/**
 * Create a versioned router that mounts routes under /v1/.
 * Also adds an alias from the unversioned path with a deprecation warning.
 */
export function createVersionedRouter(app: Router, routes: Router): void {
  // Mount under /v1
  app.use(`/${CURRENT_VERSION}`, routes);

  // Alias from unversioned with deprecation header
  app.use('/', (req: Request, res: Response, next: NextFunction) => {
    // Skip if already versioned
    if (req.path.startsWith(`/${CURRENT_VERSION}`)) {
      return next();
    }
    res.setHeader('Deprecation', 'true');
    res.setHeader('Link', `</${CURRENT_VERSION}${req.path}>; rel="successor-version"`);
    next();
  }, routes);
}

/**
 * Extract API version from request path or Accept-Version header.
 */
export function extractVersion(req: Request): string {
  // Check URL prefix first
  const pathMatch = req.path.match(/^\/(v\d+)\//);
  if (pathMatch) return pathMatch[1];

  // Fall back to Accept-Version header
  const headerVersion = req.headers['accept-version'];
  if (typeof headerVersion === 'string') return headerVersion;

  return CURRENT_VERSION;
}
