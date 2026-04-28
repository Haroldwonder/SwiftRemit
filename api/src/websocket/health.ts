/**
 * GET /ws/health
 *
 * Returns the number of currently connected WebSocket clients and the
 * server uptime in seconds.
 *
 * Available in development only (NODE_ENV === 'development').
 */

import { Router, Request, Response } from 'express';
import { Server } from 'socket.io';

export function createWsHealthRouter(io: Server): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(404).json({
        success: false,
        error: { message: 'Not found', code: 'NOT_FOUND' },
        timestamp: new Date().toISOString(),
      });
    }

    // fetchSockets() returns all sockets across all nodes (works with
    // the default in-memory adapter and with Redis adapter alike).
    const sockets = await io.fetchSockets();

    return res.json({
      success: true,
      data: {
        connectedClients: sockets.length,
        uptimeSeconds: Math.floor(process.uptime()),
      },
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
