"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rawBodyMiddleware = rawBodyMiddleware;
exports.handleRampWebhook = handleRampWebhook;
exports.setupRampWebhookRoutes = setupRampWebhookRoutes;
const express_1 = __importDefault(require("express"));
const ramp_provider_1 = require("./ramp-provider");
const ramp_event_hooks_1 = require("./ramp-event-hooks");
/** Middleware that captures the raw body for signature verification. */
function rawBodyMiddleware() {
    return express_1.default.json({
        verify: (req, _res, buf) => {
            req.rawBody = buf.toString('utf8');
        },
    });
}
async function handleRampWebhook(req, res) {
    const providerName = req.params.provider?.toLowerCase();
    const provider = (0, ramp_provider_1.getProvider)(providerName);
    if (!provider) {
        res.status(404).json({ error: `Unknown ramp provider: ${providerName}` });
        return;
    }
    const rawBody = req.rawBody ?? JSON.stringify(req.body);
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : (v ?? '')]));
    if (!provider.verifyWebhook(rawBody, headers)) {
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
    }
    try {
        const event = provider.parseEvent(req.body);
        const hook = (0, ramp_event_hooks_1.hookNameForStatus)(event.status);
        await ramp_event_hooks_1.rampHooks.emit(hook, event);
        res.status(200).json({ received: true, hook });
    }
    catch (err) {
        console.error(`[ramp-webhook] Error processing ${providerName} event:`, err);
        res.status(500).json({ error: 'Internal server error' });
    }
}
function setupRampWebhookRoutes(app) {
    app.post('/webhooks/ramp/:provider', rawBodyMiddleware(), handleRampWebhook);
}
