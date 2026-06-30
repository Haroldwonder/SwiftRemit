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
exports.AssetVerifier = void 0;
const axios_1 = __importDefault(require("axios"));
const toml = __importStar(require("toml"));
const types_1 = require("./types");
const STELLAR_EXPERT_API = 'https://api.stellar.expert/explorer/testnet';
const REQUEST_TIMEOUT = 5000;
const MAX_RETRIES = 3;
class AssetVerifier {
    httpClient;
    constructor() {
        this.httpClient = axios_1.default.create({
            timeout: REQUEST_TIMEOUT,
            headers: {
                'User-Agent': 'SwiftRemit-Verifier/1.0',
            },
        });
    }
    async verifyAsset(assetCode, issuer) {
        const sources = [];
        let totalScore = 0;
        let sourceCount = 0;
        // Check Stellar Expert
        const expertResult = await this.checkStellarExpert(assetCode, issuer);
        sources.push(expertResult);
        if (expertResult.verified) {
            totalScore += expertResult.score;
            sourceCount++;
        }
        // Check stellar.toml
        const tomlResult = await this.checkStellarToml(issuer);
        sources.push(tomlResult);
        if (tomlResult.verified) {
            totalScore += tomlResult.score;
            sourceCount++;
        }
        // Check trustline count
        const trustlineResult = await this.checkTrustlines(assetCode, issuer);
        sources.push(trustlineResult);
        if (trustlineResult.verified) {
            totalScore += trustlineResult.score;
            sourceCount++;
        }
        // Check transaction history
        const txHistoryResult = await this.checkTransactionHistory(assetCode, issuer);
        sources.push(txHistoryResult);
        if (txHistoryResult.verified) {
            totalScore += txHistoryResult.score;
            sourceCount++;
        }
        // Calculate reputation score
        const reputationScore = sourceCount > 0 ? Math.round(totalScore / sourceCount) : 0;
        // Determine status
        let status;
        if (reputationScore >= 70 && sourceCount >= 3) {
            status = types_1.VerificationStatus.Verified;
        }
        else if (reputationScore < 30 || this.hasSuspiciousIndicators(sources)) {
            status = types_1.VerificationStatus.Suspicious;
        }
        else {
            status = types_1.VerificationStatus.Unverified;
        }
        return {
            asset_code: assetCode,
            issuer,
            status,
            reputation_score: reputationScore,
            sources,
            trustline_count: trustlineResult.details?.count || 0,
            has_toml: tomlResult.verified,
        };
    }
    async checkStellarExpert(assetCode, issuer) {
        try {
            const response = await this.retryRequest(async () => {
                return await this.httpClient.get(`${STELLAR_EXPERT_API}/asset/${assetCode}-${issuer}`);
            });
            if (response.data && response.data.rating) {
                const rating = response.data.rating;
                return {
                    name: 'Stellar Expert',
                    verified: rating >= 3,
                    score: Math.min(rating * 20, 100),
                    details: { rating, age: response.data.age },
                };
            }
            return {
                name: 'Stellar Expert',
                verified: false,
                score: 0,
            };
        }
        catch (error) {
            console.error('Stellar Expert check failed:', error);
            return {
                name: 'Stellar Expert',
                verified: false,
                score: 0,
            };
        }
    }
    async checkStellarToml(issuer) {
        try {
            // Get issuer's home domain
            const accountResponse = await this.retryRequest(async () => {
                return await this.httpClient.get(`${process.env.HORIZON_URL}/accounts/${issuer}`);
            });
            const homeDomain = accountResponse.data.home_domain;
            if (!homeDomain) {
                return {
                    name: 'Stellar TOML',
                    verified: false,
                    score: 0,
                };
            }
            // Fetch stellar.toml
            const tomlUrl = `https://${homeDomain}/.well-known/stellar.toml`;
            const tomlResponse = await this.retryRequest(async () => {
                return await this.httpClient.get(tomlUrl);
            });
            const tomlData = toml.parse(tomlResponse.data);
            // Validate TOML structure
            const hasValidStructure = tomlData.DOCUMENTATION ||
                tomlData.CURRENCIES ||
                tomlData.PRINCIPALS;
            if (hasValidStructure) {
                return {
                    name: 'Stellar TOML',
                    verified: true,
                    score: 80,
                    details: {
                        domain: homeDomain,
                        has_documentation: !!tomlData.DOCUMENTATION,
                        has_currencies: !!tomlData.CURRENCIES,
                    },
                };
            }
            return {
                name: 'Stellar TOML',
                verified: false,
                score: 30,
            };
        }
        catch (error) {
            console.error('Stellar TOML check failed:', error);
            return {
                name: 'Stellar TOML',
                verified: false,
                score: 0,
            };
        }
    }
    async checkTrustlines(assetCode, issuer) {
        try {
            const response = await this.retryRequest(async () => {
                return await this.httpClient.get(`${process.env.HORIZON_URL}/assets`, {
                    params: {
                        asset_code: assetCode,
                        asset_issuer: issuer,
                    },
                });
            });
            if (response.data._embedded?.records?.length > 0) {
                const asset = response.data._embedded.records[0];
                const trustlineCount = parseInt(asset.num_accounts || '0');
                let score = 0;
                if (trustlineCount >= 10000)
                    score = 100;
                else if (trustlineCount >= 1000)
                    score = 80;
                else if (trustlineCount >= 100)
                    score = 60;
                else if (trustlineCount >= 10)
                    score = 40;
                else
                    score = 20;
                return {
                    name: 'Trustline Analysis',
                    verified: trustlineCount >= parseInt(process.env.MIN_TRUSTLINE_COUNT || '10'),
                    score,
                    details: { count: trustlineCount },
                };
            }
            return {
                name: 'Trustline Analysis',
                verified: false,
                score: 0,
                details: { count: 0 },
            };
        }
        catch (error) {
            console.error('Trustline check failed:', error);
            return {
                name: 'Trustline Analysis',
                verified: false,
                score: 0,
                details: { count: 0 },
            };
        }
    }
    async checkTransactionHistory(assetCode, issuer) {
        try {
            const response = await this.retryRequest(async () => {
                return await this.httpClient.get(`${process.env.HORIZON_URL}/accounts/${issuer}/transactions`, {
                    params: { limit: 200 },
                });
            });
            const transactions = response.data._embedded?.records || [];
            const txCount = transactions.length;
            // Check for suspicious patterns
            const recentTxs = transactions.filter((tx) => {
                const txDate = new Date(tx.created_at);
                const daysSince = (Date.now() - txDate.getTime()) / (1000 * 60 * 60 * 24);
                return daysSince <= 30;
            });
            const hasRecentActivity = recentTxs.length > 0;
            const hasHistoricalActivity = txCount > 10;
            let score = 0;
            if (hasRecentActivity && hasHistoricalActivity)
                score = 70;
            else if (hasHistoricalActivity)
                score = 50;
            else if (hasRecentActivity)
                score = 30;
            return {
                name: 'Transaction History',
                verified: hasRecentActivity && hasHistoricalActivity,
                score,
                details: {
                    total_transactions: txCount,
                    recent_transactions: recentTxs.length,
                },
            };
        }
        catch (error) {
            console.error('Transaction history check failed:', error);
            return {
                name: 'Transaction History',
                verified: false,
                score: 0,
            };
        }
    }
    hasSuspiciousIndicators(sources) {
        // Check for red flags
        const hasNoToml = !sources.find(s => s.name === 'Stellar TOML')?.verified;
        const hasLowTrustlines = (sources.find(s => s.name === 'Trustline Analysis')?.details?.count || 0) < 5;
        const hasNoHistory = !sources.find(s => s.name === 'Transaction History')?.verified;
        return hasNoToml && hasLowTrustlines && hasNoHistory;
    }
    async retryRequest(requestFn, retries = MAX_RETRIES) {
        for (let i = 0; i < retries; i++) {
            try {
                return await requestFn();
            }
            catch (error) {
                if (i === retries - 1)
                    throw error;
                await this.delay(1000 * (i + 1)); // Exponential backoff
            }
        }
        throw new Error('Max retries exceeded');
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.AssetVerifier = AssetVerifier;
