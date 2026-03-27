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
exports.KycService = void 0;
const axios_1 = __importDefault(require("axios"));
const types_1 = require("./types");
const database_1 = require("./database");
const stellar_1 = require("./stellar");
class KycService {
    configs = new Map();
    async initialize() {
        const configs = await (0, database_1.getAnchorKycConfigs)();
        this.configs = new Map(configs.map(config => [config.anchor_id, config]));
        console.log(`Initialized KYC service with ${configs.length} anchor configurations`);
    }
    async pollAllAnchors() {
        for (const [anchorId, config] of this.configs) {
            try {
                await this.pollAnchorKycStatus(anchorId, config);
            }
            catch (error) {
                console.error(`Failed to poll KYC status for anchor ${anchorId}:`, error);
            }
        }
    }
    async pollAnchorKycStatus(anchorId, config) {
        const usersToCheck = await (0, database_1.getUsersNeedingKycCheck)(anchorId, config.polling_interval_minutes);
        console.log(`Checking KYC status for ${usersToCheck.length} users on anchor ${anchorId}`);
        for (const userKyc of usersToCheck) {
            try {
                const kycResponse = await this.queryAnchorKycStatus(config, userKyc.user_id);
                if (kycResponse) {
                    const updatedStatus = {
                        ...userKyc,
                        status: this.mapSep12StatusToInternal(kycResponse.status),
                        last_checked: new Date(),
                        expires_at: kycResponse.expires_at ? new Date(kycResponse.expires_at) : undefined,
                        rejection_reason: kycResponse.rejection_reason,
                        verification_data: kycResponse.fields,
                    };
                    await (0, database_1.saveUserKycStatus)(updatedStatus);
                    // Update on-chain status if approved
                    if (updatedStatus.status === types_1.KycStatus.Approved) {
                        try {
                            await (0, stellar_1.updateKycStatusOnChain)(userKyc.user_id, true);
                        }
                        catch (error) {
                            console.error(`Failed to update on-chain KYC status for user ${userKyc.user_id}:`, error);
                        }
                    }
                    else if (updatedStatus.status === types_1.KycStatus.Rejected) {
                        try {
                            await (0, stellar_1.updateKycStatusOnChain)(userKyc.user_id, false);
                        }
                        catch (error) {
                            console.error(`Failed to update on-chain KYC status for user ${userKyc.user_id}:`, error);
                        }
                    }
                }
                // Rate limiting - wait 1 second between requests
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            catch (error) {
                console.error(`Failed to check KYC status for user ${userKyc.user_id} on anchor ${anchorId}:`, error);
            }
        }
    }
    async queryAnchorKycStatus(config, userId) {
        try {
            const url = `${config.kyc_server_url}/customer/${userId}`;
            const response = await axios_1.default.get(url, {
                headers: {
                    'Authorization': `Bearer ${config.auth_token}`,
                    'Content-Type': 'application/json',
                },
                timeout: 10000, // 10 second timeout
            });
            return response.data;
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error)) {
                if (error.response?.status === 404) {
                    // User not found in anchor's system
                    return null;
                }
                console.error(`HTTP error querying KYC status: ${error.response?.status} ${error.response?.statusText}`);
            }
            else {
                console.error('Error querying KYC status:', error);
            }
            return null;
        }
    }
    mapSep12StatusToInternal(sep12Status) {
        switch (sep12Status.toLowerCase()) {
            case 'approved':
                return types_1.KycStatus.Approved;
            case 'rejected':
                return types_1.KycStatus.Rejected;
            case 'pending':
            default:
                return types_1.KycStatus.Pending;
        }
    }
    async getUserKycStatus(userId, anchorId) {
        return await Promise.resolve().then(() => __importStar(require('./database'))).then(db => db.getUserKycStatus(userId, anchorId));
    }
    async isUserKycApproved(userId) {
        // Check if user has approved KYC with any anchor
        const approvedUsers = await (0, database_1.getApprovedUsers)();
        return approvedUsers.some(user => user.user_id === userId);
    }
    async registerUserForKyc(userId, anchorId) {
        const initialStatus = {
            user_id: userId,
            anchor_id: anchorId,
            status: types_1.KycStatus.Pending,
            last_checked: new Date(),
        };
        await (0, database_1.saveUserKycStatus)(initialStatus);
    }
}
exports.KycService = KycService;
