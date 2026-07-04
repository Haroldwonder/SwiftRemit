"use strict";
/**
 * Fiat on/off ramp provider interface and adapters.
 *
 * Normalises Transak and MoonPay webhook payloads into a canonical
 * RampOrderEvent so the rest of the system stays provider-agnostic.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MoonPayProvider = exports.TransakProvider = void 0;
exports.registerProvider = registerProvider;
exports.getProvider = getProvider;
exports.listProviders = listProviders;
const crypto_1 = __importDefault(require("crypto"));
// ── Transak adapter ────────────────────────────────────────────────
class TransakProvider {
    apiSecret;
    name = 'transak';
    constructor(apiSecret) {
        this.apiSecret = apiSecret;
    }
    verifyWebhook(payload, headers) {
        const sig = headers['x-transak-signature'] ?? headers['X-Transak-Signature'];
        if (!sig)
            return false;
        const expected = crypto_1.default.createHmac('sha256', this.apiSecret).update(payload).digest('hex');
        try {
            return crypto_1.default.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
        }
        catch {
            return false;
        }
    }
    parseEvent(payload) {
        const p = payload;
        const order = p?.data?.status ?? p?.data ?? p;
        const statusMap = {
            AWAITING_PAYMENT_FROM_USER: 'pending',
            PAYMENT_DONE_MARKED_BY_USER: 'processing',
            PROCESSING: 'processing',
            PENDING_DELIVERY_FROM_TRANSAK: 'processing',
            COMPLETED: 'completed',
            FAILED: 'failed',
            REFUNDED: 'refunded',
            CANCELLED: 'cancelled',
        };
        return {
            provider: this.name,
            orderId: String(order.id ?? order.orderId ?? ''),
            direction: order.isBuyOrSell === 'SELL' ? 'off_ramp' : 'on_ramp',
            status: statusMap[order.status] ?? 'pending',
            cryptoAmount: order.cryptoAmount,
            fiatAmount: order.fiatAmount,
            fiatCurrency: order.fiatCurrency,
            cryptoCurrency: order.cryptocurrency,
            walletAddress: order.walletAddress,
            remittanceId: order.partnerOrderId ?? order.externalId,
            raw: payload,
        };
    }
}
exports.TransakProvider = TransakProvider;
// ── MoonPay adapter ────────────────────────────────────────────────
class MoonPayProvider {
    secretKey;
    name = 'moonpay';
    constructor(secretKey) {
        this.secretKey = secretKey;
    }
    verifyWebhook(payload, headers) {
        const sig = headers['moonpay-signature-v2'] ??
            headers['MoonPay-Signature-V2'] ??
            headers['x-moonpay-signature'];
        if (!sig)
            return false;
        const expected = crypto_1.default.createHmac('sha256', this.secretKey).update(payload).digest('base64');
        try {
            return crypto_1.default.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
        }
        catch {
            return false;
        }
    }
    parseEvent(payload) {
        const p = payload;
        const tx = p?.data ?? p;
        const statusMap = {
            waitingPayment: 'pending',
            pending: 'pending',
            waitingAuthorization: 'processing',
            processing: 'processing',
            completed: 'completed',
            failed: 'failed',
            refunded: 'refunded',
        };
        return {
            provider: this.name,
            orderId: String(tx.id ?? ''),
            direction: p.type === 'transaction_sell_updated' ? 'off_ramp' : 'on_ramp',
            status: statusMap[tx.status] ?? 'pending',
            cryptoAmount: tx.quoteCurrencyAmount,
            fiatAmount: tx.baseCurrencyAmount,
            fiatCurrency: tx.baseCurrencyCode,
            cryptoCurrency: tx.quoteCurrencyCode,
            walletAddress: tx.walletAddress,
            remittanceId: tx.externalTransactionId,
            raw: payload,
        };
    }
}
exports.MoonPayProvider = MoonPayProvider;
// ── Provider registry ──────────────────────────────────────────────
const _providers = new Map();
function registerProvider(provider) {
    _providers.set(provider.name, provider);
}
function getProvider(name) {
    return _providers.get(name);
}
function listProviders() {
    return Array.from(_providers.keys());
}
