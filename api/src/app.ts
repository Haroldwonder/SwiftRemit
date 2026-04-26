import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import currenciesRouter from './routes/currencies';
import { createAnchorsRouter } from './routes/anchors';
import docsRouter from './routes/docs';
import settlementsRouter from './routes/settlements';
import { ErrorResponse } from './types';
import { AnchorStore } from './db/anchorStore';

type AppOptions = {
  anchorStore?: AnchorStore;
  anchorAdminApiKey?: string;
};

export function createApp(options: AppOptions = {}): Application {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Rate limiting
  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    message: {
      success: false,
      error: {
        message: 'Too many requests from this IP, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
      timestamp: new Date().toISOString(),
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/', limiter);

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // API routes
  app.use('/api/currencies', currenciesRouter);
  app.use(
    '/api/anchors',
    createAnchorsRouter({
      store: options.anchorStore,
      adminApiKey: options.anchorAdminApiKey,
    }),
  );

  // Settlement simulation — read-only, no state changes (Issue #420)
  app.use('/api/settlements', settlementsRouter);

  // API documentation
  app.use('/api/docs', docsRouter);

  // 404 handler
  app.use((req: Request, res: Response) => {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        message: `Route not found: ${req.method} ${req.path}`,
        code: 'ROUTE_NOT_FOUND',
      },
      timestamp: new Date().toISOString(),
    };
    res.status(404).json(errorResponse);
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Unhandled error:', err);

    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        message: process.env.NODE_ENV === 'production' 
          ? 'Internal server error' 
          : err.message,
        code: 'INTERNAL_SERVER_ERROR',
      },
      timestamp: new Date().toISOString(),
    };

    res.status(500).json(errorResponse);
  });

  return app;
}
