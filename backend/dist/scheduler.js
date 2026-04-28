"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBackgroundJobs = startBackgroundJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const verifier_1 = require("./verifier");
const database_1 = require("./database");
const stellar_1 = require("./stellar");
const kyc_service_1 = require("./kyc-service");
const verifier = new verifier_1.AssetVerifier();
const kycService = new kyc_service_1.KycService();
async function startBackgroundJobs() {
    // Initialize KYC service
    await kycService.initialize();
    // Run every 6 hours
    node_cron_1.default.schedule('0 */6 * * *', async () => {
        console.log('Starting periodic asset revalidation...');
        await revalidateStaleAssets();
    });
    // Run KYC polling every 30 minutes
    node_cron_1.default.schedule('*/30 * * * *', async () => {
        console.log('Starting KYC status polling...');
        await pollKycStatuses();
    });
    console.log('Background jobs scheduled');
}
async function revalidateStaleAssets() {
    try {
        const hoursOld = parseInt(process.env.VERIFICATION_INTERVAL_HOURS || '24');
        const staleAssets = await (0, database_1.getStaleAssets)(hoursOld);
        console.log(`Found ${staleAssets.length} assets to revalidate`);
        for (const asset of staleAssets) {
            try {
                console.log(`Revalidating ${asset.asset_code}-${asset.issuer}`);
                const result = await verifier.verifyAsset(asset.asset_code, asset.issuer);
                const verification = {
                    asset_code: result.asset_code,
                    issuer: result.issuer,
                    status: result.status,
                    reputation_score: result.reputation_score,
                    last_verified: new Date(),
                    trustline_count: result.trustline_count,
                    has_toml: result.has_toml,
                    stellar_expert_verified: result.sources.find(s => s.name === 'Stellar Expert')?.verified,
                    toml_data: result.sources.find(s => s.name === 'Stellar TOML')?.details,
                    community_reports: asset.community_reports || 0,
                };
                await (0, database_1.saveAssetVerification)(verification);
                // Store on-chain
                try {
                    await (0, stellar_1.storeVerificationOnChain)(verification);
                }
                catch (error) {
                    console.error(`Failed to store on-chain for ${asset.asset_code}:`, error);
                }
                // Rate limiting - wait 1 second between verifications
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            catch (error) {
                console.error(`Failed to revalidate ${asset.asset_code}:`, error);
            }
        }
        console.log('Periodic revalidation completed');
    }
    catch (error) {
        console.error('Error in revalidation job:', error);
    }
}
async function pollKycStatuses() {
    try {
        await kycService.pollAllAnchors();
        console.log('KYC polling completed');
    }
    catch (error) {
        console.error('Error in KYC polling job:', error);
    }
}
