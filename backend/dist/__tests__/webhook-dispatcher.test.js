"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const webhook_dispatcher_1 = require("../webhook-dispatcher");
const database_1 = require("../database");
vitest_1.vi.mock('../database', () => ({
    getActiveWebhookSubscribers: vitest_1.vi.fn(),
    enqueueWebhookDelivery: vitest_1.vi.fn(),
    getPendingWebhookDeliveries: vitest_1.vi.fn(),
    markWebhookDeliveryFailure: vitest_1.vi.fn(),
    markWebhookDeliverySuccess: vitest_1.vi.fn(),
}));
const subscriberA = {
    id: 'sub-1',
    url: 'https://subscriber-a.test/webhook',
    secret: null,
    active: true,
    created_at: new Date(),
    updated_at: new Date(),
};
const subscriberB = {
    id: 'sub-2',
    url: 'https://subscriber-b.test/webhook',
    secret: null,
    active: true,
    created_at: new Date(),
    updated_at: new Date(),
};
function makeDelivery(id, targetUrl, attempts = 0) {
    return {
        id,
        event_type: 'remittance.created',
        event_key: '42',
        subscriber_id: `sub-${id}`,
        target_url: targetUrl,
        payload: {
            remittance_id: '42',
            sender: 'GSENDER',
            agent: 'GAGENT',
            amount: '10000000',
            fee: '100000',
            expiry: '1777777777',
        },
        status: 'pending',
        attempt_count: attempts,
        max_attempts: 5,
        next_retry_at: new Date(),
        last_error: null,
        response_status: null,
        delivered_at: null,
    };
}
(0, vitest_1.describe)('WebhookDispatcher', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.it)('dispatches remittance.created to all active subscribers', async () => {
        const fetchMock = vitest_1.vi.fn().mockResolvedValue({ ok: true, status: 200 });
        vitest_1.vi.mocked(database_1.getActiveWebhookSubscribers).mockResolvedValue([subscriberA, subscriberB]);
        vitest_1.vi.mocked(database_1.enqueueWebhookDelivery)
            .mockResolvedValueOnce(makeDelivery('1', subscriberA.url))
            .mockResolvedValueOnce(makeDelivery('2', subscriberB.url));
        const dispatcher = new webhook_dispatcher_1.WebhookDispatcher(fetchMock);
        await dispatcher.dispatchRemittanceCreated({
            remittance_id: '42',
            sender: 'GSENDER',
            agent: 'GAGENT',
            amount: '10000000',
            fee: '100000',
            expiry: '1777777777',
        });
        (0, vitest_1.expect)(database_1.getActiveWebhookSubscribers).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(database_1.enqueueWebhookDelivery).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(fetchMock).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(database_1.markWebhookDeliverySuccess).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)('marks failed delivery pending with incremented attempt count for retry', async () => {
        const fetchMock = vitest_1.vi.fn().mockResolvedValue({ ok: false, status: 500 });
        const delivery = makeDelivery('retry-1', subscriberA.url, 0);
        vitest_1.vi.mocked(database_1.getPendingWebhookDeliveries).mockResolvedValue([delivery]);
        const dispatcher = new webhook_dispatcher_1.WebhookDispatcher(fetchMock);
        await dispatcher.retryPendingDeliveries();
        (0, vitest_1.expect)(database_1.getPendingWebhookDeliveries).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(database_1.markWebhookDeliveryFailure).toHaveBeenCalledTimes(1);
        const args = vitest_1.vi.mocked(database_1.markWebhookDeliveryFailure).mock.calls[0];
        (0, vitest_1.expect)(args[0]).toBe(delivery.id);
        (0, vitest_1.expect)(args[1]).toBe(1);
        (0, vitest_1.expect)(args[2]).toBe(5);
        (0, vitest_1.expect)(args[4]).toContain('status 500');
        (0, vitest_1.expect)(args[5]).toBe(500);
    });
});
