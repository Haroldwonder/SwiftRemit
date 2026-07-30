/**
 * Device token routes — SR-095
 *
 * POST   /api/devices/register      Register a push token for the authenticated user.
 * DELETE /api/devices/deregister    Remove a push token (called on logout).
 *
 * Both endpoints require a valid Bearer token (same auth middleware used
 * by the rest of the API). The userId is derived from the authenticated
 * principal, never accepted directly from the request body, to prevent
 * users registering tokens under other users' accounts.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DeviceTokenService, Platform } from '../device-token-service';
import { Pool } from 'pg';

// ─── Validation schemas ───────────────────────────────────────────────────────

const RegisterSchema = z.object({
  token:    z.string().min(10).max(512),
  platform: z.enum(['ios', 'android', 'web'] as const),
});

const DeregisterSchema = z.object({
  token: z.string().min(10).max(512),
});

// ─── Route factory ────────────────────────────────────────────────────────────

export function createDeviceRouter(pool: Pool): Router {
  const router = Router();
  const svc = new DeviceTokenService(pool);

  /**
   * POST /api/devices/register
   * Body: { token: string, platform: 'ios' | 'android' | 'web' }
   *
   * The authenticated user's ID is read from req.user (set by the auth
   * middleware that processes the Bearer JWT).  If your middleware attaches
   * a different property name, adjust the cast below.
   */
  router.post('/register', async (req: Request, res: Response) => {
    const authReq = req as Request & { user?: { id: string; walletAddress?: string } };
    const userId = authReq.user?.id ?? authReq.user?.walletAddress;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
      return;
    }

    try {
      await svc.register({
        userId,
        token: parsed.data.token,
        platform: parsed.data.platform as Platform,
      });
      res.status(204).end();
    } catch (err) {
      console.error('[devices] register error:', err);
      res.status(500).json({ error: 'Failed to register device token' });
    }
  });

  /**
   * DELETE /api/devices/deregister
   * Body: { token: string }
   *
   * Removes a specific token so the device stops receiving pushes after
   * logout. No auth check needed beyond a valid token string — the caller
   * can only delete the token they already possess.
   */
  router.delete('/deregister', async (req: Request, res: Response) => {
    const parsed = DeregisterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
      return;
    }

    try {
      await svc.deregister(parsed.data.token);
      res.status(204).end();
    } catch (err) {
      console.error('[devices] deregister error:', err);
      res.status(500).json({ error: 'Failed to deregister device token' });
    }
  });

  return router;
}
