"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookDispatcher = void 0;
const database_1 = require("./database");
const MAX_RETRIES = 5;
class WebhookDispatcher {
    fetchImpl;
    constructor(fetchImpl = fetch) {
        this.fetchImpl = fetchImpl;
    }
    async dispatchRemittanceCreated(payload) {
        const subscribers = await (0, database_1.getActiveWebhookSubscribers)();
        const deliveries = await Promise.all(subscribers.map((subscriber) => (0, database_1.enqueueWebhookDelivery)('remittance.created', payload.remittance_id, subscriber, payload, MAX_RETRIES)));
        for (const delivery of deliveries) {
            await this.attemptDelivery(delivery);
        }
    }
    async retryPendingDeliveries(limit = 100) {
        const deliveries = await (0, database_1.getPendingWebhookDeliveries)(limit);
        for (const delivery of deliveries) {
            await this.attemptDelivery(delivery);
        }
    }
    async attemptDelivery(delivery) {
        const nextAttempt = delivery.attempt_count + 1;
        try {
            const response = await this.fetchImpl(delivery.target_url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-event-type': delivery.event_type,
                    'x-attempt': String(nextAttempt),
                },
                body: JSON.stringify(delivery.payload),
            });
            if (response.ok) {
                await (0, database_1.markWebhookDeliverySuccess)(delivery.id, response.status);
                return;
            }
            await this.scheduleFailure(delivery, nextAttempt, `Webhook delivery failed with status ${response.status}`, response.status);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown webhook delivery failure';
            await this.scheduleFailure(delivery, nextAttempt, message, null);
        }
    }
    async scheduleFailure(delivery, nextAttempt, message, responseStatus) {
        const nextRetryAt = new Date(Date.now() + this.retryDelayMs(nextAttempt));
        await (0, database_1.markWebhookDeliveryFailure)(delivery.id, nextAttempt, delivery.max_attempts, nextRetryAt, message, responseStatus);
    }
    retryDelayMs(attempt) {
        return 1000 * attempt;
    }
}
exports.WebhookDispatcher = WebhookDispatcher;
