import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

export function createHealthRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    let dbStatus: 'healthy' | 'unhealthy' = 'unhealthy';
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      dbStatus = 'healthy';
    } catch {
      // db unreachable or timed out
    }
    const status = dbStatus === 'healthy' ? 200 : 503;
    res.status(status).json({
      status: dbStatus === 'healthy' ? 'ok' : 'degraded',
      db: dbStatus,
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/db', async (_req: Request, res: Response) => {
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      res.status(200).json({
        status: 'ok',
        pool: {
          active: pool.totalCount - pool.idleCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        },
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: 'error',
        error: 'Database unreachable',
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}
