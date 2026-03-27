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
const kyc_service_1 = require("../kyc-service");
const types_1 = require("../types");
// Mock the database functions
vitest_1.vi.mock('../database', () => ({
    getAnchorKycConfigs: vitest_1.vi.fn(),
    getUsersNeedingKycCheck: vitest_1.vi.fn(),
    saveUserKycStatus: vitest_1.vi.fn(),
    getUserKycStatus: vitest_1.vi.fn(),
    getApprovedUsers: vitest_1.vi.fn(),
}));
// Mock the stellar functions
vitest_1.vi.mock('../stellar', () => ({
    updateKycStatusOnChain: vitest_1.vi.fn(),
}));
// Mock axios
vitest_1.vi.mock('axios');
const axios_1 = __importDefault(require("axios"));
(0, vitest_1.describe)('KycService', () => {
    let kycService;
    (0, vitest_1.beforeEach)(() => {
        kycService = new kyc_service_1.KycService();
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.describe)('initialize', () => {
        (0, vitest_1.it)('should load anchor configurations', async () => {
            const mockConfigs = [
                {
                    anchor_id: 'anchor-1',
                    kyc_server_url: 'https://kyc.anchor1.com',
                    auth_token: 'token1',
                    polling_interval_minutes: 60,
                    enabled: true,
                },
            ];
            const { getAnchorKycConfigs } = await Promise.resolve().then(() => __importStar(require('../database')));
            getAnchorKycConfigs.mockResolvedValue(mockConfigs);
            await kycService.initialize();
            (0, vitest_1.expect)(getAnchorKycConfigs).toHaveBeenCalled();
        });
    });
    (0, vitest_1.describe)('pollAllAnchors', () => {
        (0, vitest_1.it)('should poll KYC status for all configured anchors', async () => {
            const mockConfigs = [
                {
                    anchor_id: 'anchor-1',
                    kyc_server_url: 'https://kyc.anchor1.com',
                    auth_token: 'token1',
                    polling_interval_minutes: 60,
                    enabled: true,
                },
            ];
            const { getAnchorKycConfigs, getUsersNeedingKycCheck } = await Promise.resolve().then(() => __importStar(require('../database')));
            getAnchorKycConfigs.mockResolvedValue(mockConfigs);
            getUsersNeedingKycCheck.mockResolvedValue([]);
            await kycService.initialize();
            await kycService.pollAllAnchors();
            (0, vitest_1.expect)(getUsersNeedingKycCheck).toHaveBeenCalledWith('anchor-1', 60);
        });
    });
    (0, vitest_1.describe)('queryAnchorKycStatus', () => {
        (0, vitest_1.it)('should return KYC status from anchor API', async () => {
            const mockResponse = {
                data: {
                    id: 'user123',
                    status: 'approved',
                    expires_at: '2024-12-31T23:59:59Z',
                },
            };
            axios_1.default.get.mockResolvedValue(mockResponse);
            const config = {
                anchor_id: 'anchor-1',
                kyc_server_url: 'https://kyc.anchor1.com',
                auth_token: 'token1',
                polling_interval_minutes: 60,
                enabled: true,
            };
            // Access private method for testing
            const result = await kycService.queryAnchorKycStatus(config, 'user123');
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledWith('https://kyc.anchor1.com/customer/user123', vitest_1.expect.objectContaining({
                headers: {
                    'Authorization': 'Bearer token1',
                    'Content-Type': 'application/json',
                },
            }));
            (0, vitest_1.expect)(result).toEqual(mockResponse.data);
        });
        (0, vitest_1.it)('should return null when user not found', async () => {
            const error = {
                response: { status: 404 },
            };
            axios_1.default.get.mockRejectedValue(error);
            const config = {
                anchor_id: 'anchor-1',
                kyc_server_url: 'https://kyc.anchor1.com',
                auth_token: 'token1',
                polling_interval_minutes: 60,
                enabled: true,
            };
            const result = await kycService.queryAnchorKycStatus(config, 'user123');
            (0, vitest_1.expect)(result).toBeNull();
        });
    });
    (0, vitest_1.describe)('mapSep12StatusToInternal', () => {
        (0, vitest_1.it)('should map SEP-12 statuses correctly', () => {
            (0, vitest_1.expect)(kycService.mapSep12StatusToInternal('approved')).toBe(types_1.KycStatus.Approved);
            (0, vitest_1.expect)(kycService.mapSep12StatusToInternal('rejected')).toBe(types_1.KycStatus.Rejected);
            (0, vitest_1.expect)(kycService.mapSep12StatusToInternal('pending')).toBe(types_1.KycStatus.Pending);
            (0, vitest_1.expect)(kycService.mapSep12StatusToInternal('unknown')).toBe(types_1.KycStatus.Pending);
        });
    });
    (0, vitest_1.describe)('isUserKycApproved', () => {
        (0, vitest_1.it)('should return true if user has approved KYC', async () => {
            const { getApprovedUsers } = await Promise.resolve().then(() => __importStar(require('../database')));
            getApprovedUsers.mockResolvedValue([
                {
                    user_id: 'user123',
                    anchor_id: 'anchor-1',
                    status: types_1.KycStatus.Approved,
                    last_checked: new Date(),
                },
            ]);
            const result = await kycService.isUserKycApproved('user123');
            (0, vitest_1.expect)(result).toBe(true);
            (0, vitest_1.expect)(getApprovedUsers).toHaveBeenCalled();
        });
        (0, vitest_1.it)('should return false if user has no approved KYC', async () => {
            const { getApprovedUsers } = await Promise.resolve().then(() => __importStar(require('../database')));
            getApprovedUsers.mockResolvedValue([]);
            const result = await kycService.isUserKycApproved('user123');
            (0, vitest_1.expect)(result).toBe(false);
        });
    });
});
