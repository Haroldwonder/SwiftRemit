/**
 * Express route handler for fiat on/off ramp provider webhooks.
 *
 * POST /webhooks/ramp/:provider
 *
 * 1. Looks up the registered RampProvider by name.
 * 2. Verifies the webhook signature.
 * 3. Validates event timestamp (rejects events outside a 5-minute window).
 * 4. Checks for replayed events (deduplicates by provider + event ID).
 * 5. Parses the payload into a canonical RampOrderEvent.
 * 6. Persists the event durably before processing asynchronously.
 * 7. Emits the appropriate hook via rampHooks.
 */

import express, { Request, Response } from 'express';
import { getProvider } from './ramp-provider';
import { rampHooks, hookNameForStatus } from './ramp-event-hooks';
import { recordRampEvent } from './database';

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
  const providerName = (req.params.provider as string)?.toLowerCase();
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

    // Validate event timestamp (within 5 minute window)
    if (event.timestamp) {
      const now = Date.now();
      const eventTime = event.timestamp.getTime();
      const diffMs = Math.abs(now - eventTime);
      const maxWindow = 5 * 60 * 1000; // 5 minutes

      if (diffMs > maxWindow) {
        res.status(401).json({ error: 'Event timestamp outside acceptable window' });
        return;
      }
    }

    // Check for replayed events
    const isNewEvent = await recordRampEvent(event.provider, event.orderId);
    if (!isNewEvent) {
      res.status(200).json({ received: true, hook: 'order.duplicate', message: 'Event already processed' });
      return;
    }

    // Process event asynchronously after confirming durability
    const hook = hookNameForStatus(event.status);
    res.status(200).json({ received: true, hook });

    // Fire hook asynchronously without blocking the response
    rampHooks.emit(hook, event).catch((err) => {
      console.error(`[ramp-webhook] Error emitting ${providerName} event hook:`, err);
    });
  } catch (err) {
    console.error(`[ramp-webhook] Error processing ${providerName} event:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function setupRampWebhookRoutes(app: express.Application): void {
  app.post('/webhooks/ramp/:provider', rawBodyMiddleware(), handleRampWebhook);
}
