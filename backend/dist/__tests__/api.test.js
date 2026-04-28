"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const api_1 = __importDefault(require("../api"));
const database_1 = require("../database");
const stellar = __importStar(require("../stellar"));
(0, vitest_1.describe)('API Endpoints', () => {
    (0, vitest_1.beforeAll)(async () => {
        try {
            await (0, database_1.initDatabase)();
        }
        catch {
            // DB not available in CI/local without Postgres — tests that don't need DB still run
        }
    });
    (0, vitest_1.describe)('GET /health', () => {
        (0, vitest_1.it)('should return health status', async () => {
            const response = await (0, supertest_1.default)(api_1.default).get('/health');
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(response.body.status).toBe('ok');
        });
    });
    (0, vitest_1.describe)('GET /api/verification/:assetCode/:issuer', () => {
        (0, vitest_1.it)('should return 400 for invalid asset code', async () => {
            const response = await (0, supertest_1.default)(api_1.default).get('/api/verification/TOOLONGASSETCODE/GXXX');
            (0, vitest_1.expect)(response.status).toBe(400);
        });
        (0, vitest_1.it)('should return 400 for invalid issuer', async () => {
            const response = await (0, supertest_1.default)(api_1.default).get('/api/verification/USDC/INVALID');
            (0, vitest_1.expect)(response.status).toBe(400);
        });
        (0, vitest_1.it)('should return 404 for non-existent asset', async () => {
            const response = await (0, supertest_1.default)(api_1.default).get('/api/verification/NOTFOUND/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
            (0, vitest_1.expect)(response.status).toBe(404);
        });
    });
    (0, vitest_1.describe)('POST /api/verification/verify', () => {
        (0, vitest_1.it)('should verify an asset', async () => {
            const response = await (0, supertest_1.default)(api_1.default)
                .post('/api/verification/verify')
                .send({
                assetCode: 'USDC',
                issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            });
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.verification).toBeDefined();
        });
        (0, vitest_1.it)('should reject invalid input', async () => {
            const response = await (0, supertest_1.default)(api_1.default)
                .post('/api/verification/verify')
                .send({
                assetCode: 'TOOLONGASSETCODE',
                issuer: 'INVALID',
            });
            (0, vitest_1.expect)(response.status).toBe(400);
        });
    });
    (0, vitest_1.describe)('POST /api/verification/report', () => {
        (0, vitest_1.it)('should require reason', async () => {
            const response = await (0, supertest_1.default)(api_1.default)
                .post('/api/verification/report')
                .send({
                assetCode: 'USDC',
                issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            });
            (0, vitest_1.expect)(response.status).toBe(400);
        });
        (0, vitest_1.it)('should reject too long reason', async () => {
            const response = await (0, supertest_1.default)(api_1.default)
                .post('/api/verification/report')
                .send({
                assetCode: 'USDC',
                issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
                reason: 'x'.repeat(501),
            });
            (0, vitest_1.expect)(response.status).toBe(400);
        });
    });
    (0, vitest_1.describe)('GET /api/verification/verified', () => {
        (0, vitest_1.it)('should return verified assets', async () => {
            const response = await (0, supertest_1.default)(api_1.default).get('/api/verification/verified');
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(response.body.assets).toBeDefined();
            (0, vitest_1.expect)(Array.isArray(response.body.assets)).toBe(true);
        });
        (0, vitest_1.it)('should respect limit parameter', async () => {
            const response = await (0, supertest_1.default)(api_1.default).get('/api/verification/verified?limit=10');
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(response.body.assets.length).toBeLessThanOrEqual(10);
        });
    });
    (0, vitest_1.describe)('POST /api/verification/batch', () => {
        (0, vitest_1.it)('should handle batch requests', async () => {
            const response = await (0, supertest_1.default)(api_1.default)
                .post('/api/verification/batch')
                .send({
                assets: [
                    {
                        assetCode: 'USDC',
                        issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
                    },
                ],
            });
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(response.body.results).toBeDefined();
            (0, vitest_1.expect)(Array.isArray(response.body.results)).toBe(true);
        });
        (0, vitest_1.it)('should reject too many assets', async () => {
            const assets = Array(51).fill({
                assetCode: 'USDC',
                issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            });
            const response = await (0, supertest_1.default)(api_1.default)
                .post('/api/verification/batch')
                .send({ assets });
            (0, vitest_1.expect)(response.status).toBe(400);
        });
    });
    (0, vitest_1.describe)('POST /api/simulate-settlement', () => {
        (0, vitest_1.it)('should return 400 when remittanceId is missing', async () => {
            const response = await (0, supertest_1.default)(api_1.default)
                .post('/api/simulate-settlement')
                .send({});
            (0, vitest_1.expect)(response.status).toBe(400);
            (0, vitest_1.expect)(response.body.error).toMatch(/remittanceId/);
        });
        (0, vitest_1.it)('should return 400 when remittanceId is zero', async () => {
            const response = await (0, supertest_1.default)(api_1.default)
                .post('/api/simulate-settlement')
                .send({ remittanceId: 0 });
            (0, vitest_1.expect)(response.status).toBe(400);
        });
        (0, vitest_1.it)('should return 400 when remittanceId is negative', async () => {
            const response = await (0, supertest_1.default)(api_1.default)
                .post('/api/simulate-settlement')
                .send({ remittanceId: -5 });
            (0, vitest_1.expect)(response.status).toBe(400);
        });
        (0, vitest_1.it)('should return 400 when remittanceId is not an integer', async () => {
            const response = await (0, supertest_1.default)(api_1.default)
                .post('/api/simulate-settlement')
                .send({ remittanceId: 1.5 });
            (0, vitest_1.expect)(response.status).toBe(400);
        });
        (0, vitest_1.it)('should return 400 when remittanceId is a string', async () => {
            const response = await (0, supertest_1.default)(api_1.default)
                .post('/api/simulate-settlement')
                .send({ remittanceId: 'abc' });
            (0, vitest_1.expect)(response.status).toBe(400);
        });
        (0, vitest_1.it)('should return 200 with simulation result for valid remittanceId', async () => {
            vitest_1.vi.spyOn(stellar, 'simulateSettlement').mockResolvedValueOnce({
                would_succeed: true,
                payout_amount: '9750',
                fee: '250',
                error_message: null,
            });
            const response = await (0, supertest_1.default)(api_1.default)
                .post('/api/simulate-settlement')
                .send({ remittanceId: 1 });
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(response.body.would_succeed).toBe(true);
            (0, vitest_1.expect)(response.body.payout_amount).toBe('9750');
            (0, vitest_1.expect)(response.body.fee).toBe('250');
            (0, vitest_1.expect)(response.body.error_message).toBeNull();
        });
        (0, vitest_1.it)('should return 200 with would_succeed false when simulation fails', async () => {
            vitest_1.vi.spyOn(stellar, 'simulateSettlement').mockResolvedValueOnce({
                would_succeed: false,
                payout_amount: '0',
                fee: '0',
                error_message: null,
            });
            const response = await (0, supertest_1.default)(api_1.default)
                .post('/api/simulate-settlement')
                .send({ remittanceId: 999 });
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(response.body.would_succeed).toBe(false);
        });
    });
});
