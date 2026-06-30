/**
 * Express route handler for fiat on/off ramp provider webhooks.
 *
 * POST /webhooks/ramp/:provider
 *
 * 1. Looks up the registered RampProvider by name.
 * 2. Verifies the webhook signature.
 * 3. Parses the payload into a canonical RampOrderEvent.
 * 4. Emits the appropriate hook via rampHooks.
 */

import express, { Request, Response } from 'express';
import { getProvider } from './ramp-provider';
import { rampHooks, hookNameForStatus } from './ramp-event-hooks';

interface RawBodyRequest extends Request {
  rawBody?: string;
}

/** Middleware that captures the raw body for signature verification. */
export function rawBodyMiddleware() {
  return express.json({
    verify: (req: RawBodyRequest, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  });
}

export async function handleRampWebhook(req: RawBodyRequest, res: Response): Promise<void> {
  const providerName = req.params.provider?.toLowerCase();
  const provider = getProvider(providerName);

  if (!provider) {
    res.status(404).json({ error: `Unknown ramp provider: ${providerName}` });
    return;
  }

  const rawBody = req.rawBody ?? JSON.stringify(req.body);
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : (v ?? '')])
  );

  if (!provider.verifyWebhook(rawBody, headers)) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  try {
    const event = provider.parseEvent(req.body);
    const hook = hookNameForStatus(event.status);
    await rampHooks.emit(hook, event);
    res.status(200).json({ received: true, hook });
  } catch (err) {
    console.error(`[ramp-webhook] Error processing ${providerName} event:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function setupRampWebhookRoutes(app: express.Application): void {
  app.post('/webhooks/ramp/:provider', rawBodyMiddleware(), handleRampWebhook);
}
