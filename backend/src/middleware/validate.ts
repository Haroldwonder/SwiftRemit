import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Middleware to validate request body against a Zod schema.
 * Responds with 400 and error details if validation fails.
 */
export function validateRequest(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = schema.parse(req.body);
      req.body = validated;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
            code: e.code,
          })),
        });
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

/**
 * Middleware to validate request query parameters against a Zod schema.
 * Coerces numeric strings to numbers automatically.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Coerce query string numbers to actual numbers for validation
      const coercedQuery = Object.entries(req.query).reduce((acc, [key, val]) => {
        if (typeof val === 'string' && /^\d+$/.test(val)) {
          acc[key] = parseInt(val, 10);
        } else {
          acc[key] = val;
        }
        return acc;
      }, {} as Record<string, any>);

      const validated = schema.parse(coercedQuery);
      req.query = validated as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
