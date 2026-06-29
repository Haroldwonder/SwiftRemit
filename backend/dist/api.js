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
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const verifier_1 = require("./verifier");
const database_1 = require("./database");
const stellar_1 = require("./stellar");
const types_1 = require("./types");
const kyc_upsert_service_1 = require("./kyc-upsert-service");
const transfer_guard_1 = require("./transfer-guard");
const fx_rate_cache_1 = require("./fx-rate-cache");
const correlation_id_1 = require("./correlation-id");
const metrics_1 = require("./metrics");
const sanitizer_1 = require("./sanitizer");
const docs_1 = __importDefault(require("./routes/docs"));
const app = (0, express_1.default)();
const fxRateCache = (0, fx_rate_cache_1.getFxRateCache)();
const verifier = new verifier_1.AssetVerifier();
const logger = (0, correlation_id_1.createLogger)('api');
const pool = (0, database_1.getPool)();
const metricsService = (0, metrics_1.getMetricsService)(pool);
fxRateCache.setMetricsObserver((from, to, stalenessSeconds) => {
    metricsService.setFxRateStalenessMetric(from, to, stalenessSeconds);
});
// Security middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Correlation ID middleware
app.use(correlation_id_1.correlationIdMiddleware);
const kycUpsertService = new kyc_upsert_service_1.KycUpsertService(pool);
const transferGuard = (0, transfer_guard_1.createTransferGuard)(kycUpsertService);
// Initialize SEP-24 service
let sep24Service = null;
async function getSep24ServiceInstance() {
    if (!sep24Service) {
        sep24Service = new Sep24Service(pool);
        await sep24Service.initialize();
    }
    return sep24Service;
}
// Rate limiting
const limiter = (0, express_rate_limit_1.default)({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);
// Metrics endpoint (excluded from rate limiting)
app.get('/metrics', async (req, res) => {
    try {
        const metrics = await metricsService.getMetrics();
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(metrics);
    }
    catch (error) {
        logger.error('Error generating metrics', error);
        res.status(500).send('# Error generating metrics\n');
    }
});
// API documentation
app.use('/api/docs', docs_1.default);
// Input validation middleware
function validateAssetParams(req, res, next) {
    const { assetCode, issuer } = req.body;
    if (!assetCode || typeof assetCode !== 'string' || assetCode.length > 12) {
        return res.status(400).json({ error: 'Invalid asset code' });
    }
    if (!issuer || typeof issuer !== 'string' || issuer.length !== 56) {
        return res.status(400).json({ error: 'Invalid issuer address' });
    }
    next();
}
function authMiddleware(req, res, next) {
    const userId = req.headers['x-user-id'] || '';
    if (!userId || typeof userId !== 'string') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = { id: userId };
    next();
}
// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Get asset verification status
app.get('/api/verification/:assetCode/:issuer', async (req, res) => {
    try {
        const { assetCode, issuer } = req.params;
        // Input validation
        if (!assetCode || assetCode.length > 12) {
            return res.status(400).json({ error: 'Invalid asset code' });
        }
        if (!issuer || issuer.length !== 56) {
            return res.status(400).json({ error: 'Invalid issuer address' });
        }
        const verification = await (0, database_1.getAssetVerification)(assetCode, issuer);
        if (!verification) {
            return res.status(404).json({ error: 'Asset verification not found' });
        }
        res.json(verification);
    }
    catch (error) {
        console.error('Error fetching verification:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Verify asset (trigger new verification)
app.post('/api/verification/verify', validateAssetParams, async (req, res) => {
    try {
        const { assetCode, issuer } = req.body;
        // Perform verification
        const result = await verifier.verifyAsset(assetCode, issuer);
        // Save to database
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
            community_reports: 0,
        };
        await (0, database_1.saveAssetVerification)(verification);
        // Store on-chain
        try {
            await (0, stellar_1.storeVerificationOnChain)(verification);
        }
        catch (error) {
            console.error('Failed to store on-chain:', error);
            // Continue even if on-chain storage fails
        }
        res.json({
            success: true,
            verification: result,
        });
    }
    catch (error) {
        console.error('Error verifying asset:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});
// Report suspicious asset
app.post('/api/verification/report', validateAssetParams, async (req, res) => {
    try {
        const { assetCode, issuer, reason } = req.body;
        if (!reason || typeof reason !== 'string' || reason.length > 500) {
            return res.status(400).json({ error: 'Invalid or missing reason' });
        }
        // Sanitize input to prevent XSS attacks
        const sanitizedReason = (0, sanitizer_1.sanitizeInput)(reason);
        // Check if asset exists
        const existing = await (0, database_1.getAssetVerification)(assetCode, issuer);
        if (!existing) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        // Increment report count
        await (0, database_1.reportSuspiciousAsset)(assetCode, issuer);
        // Save the report with sanitized reason for audit trail
        await (0, database_1.saveAssetReport)(assetCode, issuer, sanitizedReason);
        // If reports exceed threshold, mark as suspicious
        const updated = await (0, database_1.getAssetVerification)(assetCode, issuer);
        if (updated && updated.community_reports && updated.community_reports >= 5) {
            updated.status = types_1.VerificationStatus.Suspicious;
            updated.reputation_score = Math.min(updated.reputation_score, 30);
            await (0, database_1.saveAssetVerification)(updated);
            // Update on-chain
            try {
                await (0, stellar_1.storeVerificationOnChain)(updated);
            }
            catch (error) {
                console.error('Failed to update on-chain:', error);
            }
        }
        res.json({
            success: true,
            message: 'Report submitted successfully',
        });
    }
    catch (error) {
        console.error('Error reporting asset:', error);
        res.status(500).json({ error: 'Failed to submit report' });
    }
});
// List verified assets
app.get('/api/verification/verified', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const assets = await (0, database_1.getVerifiedAssets)(limit);
        res.json({
            count: assets.length,
            assets,
        });
    }
    catch (error) {
        console.error('Error fetching verified assets:', error);
        res.status(500).json({ error: 'Failed to fetch verified assets' });
    }
});
// Batch verification status
app.post('/api/verification/batch', async (req, res) => {
    try {
        const { assets } = req.body;
        if (!Array.isArray(assets) || assets.length === 0 || assets.length > 50) {
            return res.status(400).json({ error: 'Invalid assets array (max 50)' });
        }
        const results = await Promise.all(assets.map(async ({ assetCode, issuer }) => {
            try {
                const verification = await (0, database_1.getAssetVerification)(assetCode, issuer);
                return {
                    assetCode,
                    issuer,
                    verification: verification || null,
                };
            }
            catch (error) {
                return {
                    assetCode,
                    issuer,
                    verification: null,
                    error: 'Failed to fetch',
                };
            }
        }));
        res.json({ results });
    }
    catch (error) {
        console.error('Error in batch verification:', error);
        res.status(500).json({ error: 'Batch verification failed' });
    }
});
// KYC status endpoint
app.get('/api/kyc/status', authMiddleware, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const status = await kycUpsertService.getStatusForUser(userId);
        return res.status(200).json(status);
    }
    catch (error) {
        console.error('Error fetching KYC status:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// Transfer endpoint (guarded)
app.post('/api/transfer', authMiddleware, transferGuard, async (req, res) => {
    return res.status(200).json({ success: true, message: 'Transfer allowed' });
});
// Store FX rate for transaction
app.post('/api/fx-rate', async (req, res) => {
    try {
        const { transactionId, rate, provider, fromCurrency, toCurrency } = req.body;
        if (!transactionId || typeof transactionId !== 'string') {
            return res.status(400).json({ error: 'Invalid transaction ID' });
        }
        if (!rate || typeof rate !== 'number' || rate <= 0) {
            return res.status(400).json({ error: 'Invalid rate' });
        }
        if (!provider || typeof provider !== 'string') {
            return res.status(400).json({ error: 'Invalid provider' });
        }
        if (!fromCurrency || !toCurrency) {
            return res.status(400).json({ error: 'Invalid currencies' });
        }
        await (0, database_1.saveFxRate)({
            transaction_id: transactionId,
            rate,
            provider,
            timestamp: new Date(),
            from_currency: fromCurrency,
            to_currency: toCurrency,
        });
        res.json({ success: true, message: 'FX rate stored successfully' });
    }
    catch (error) {
        console.error('Error storing FX rate:', error);
        res.status(500).json({ error: 'Failed to store FX rate' });
    }
});
// Get FX rate for transaction
app.get('/api/fx-rate/:transactionId', async (req, res) => {
    try {
        const { transactionId } = req.params;
        if (!transactionId) {
            return res.status(400).json({ error: 'Invalid transaction ID' });
        }
        const fxRate = await (0, database_1.getFxRate)(transactionId);
        if (!fxRate) {
            return res.status(404).json({ error: 'FX rate not found for this transaction' });
        }
        res.json({
            ...fxRate,
            fx_rate_source: fxRate.provider,
        });
    }
    catch (error) {
        console.error('Error fetching FX rate:', error);
        res.status(500).json({ error: 'Failed to fetch FX rate' });
    }
});
// Get current FX rate (cached)
app.get('/api/fx-rate/current', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || typeof from !== 'string' || from.length > 10) {
            return res.status(400).json({ error: 'Invalid from currency' });
        }
        if (!to || typeof to !== 'string' || to.length > 10) {
            return res.status(400).json({ error: 'Invalid to currency' });
        }
        const rate = await fxRateCache.getCurrentRate(from.toUpperCase(), to.toUpperCase());
        res.json(rate);
    }
    catch (error) {
        console.error('Error fetching current FX rate:', error);
        res.status(500).json({ error: 'Failed to fetch current FX rate' });
    }
});
// KYC-related endpoints
// Configure anchor KYC settings (admin only)
app.post('/api/kyc/config', async (req, res) => {
    try {
        const { anchorId, kycServerUrl, authToken, pollingIntervalMinutes, enabled } = req.body;
        if (!anchorId || !kycServerUrl || !authToken) {
            return res.status(400).json({ error: 'Missing required fields: anchorId, kycServerUrl, authToken' });
        }
        const config = {
            anchor_id: anchorId,
            kyc_server_url: kycServerUrl,
            auth_token: authToken,
            polling_interval_minutes: pollingIntervalMinutes || 60,
            enabled: enabled !== false,
        };
        await (0, database_1.saveAnchorKycConfig)(config);
        res.json({ success: true, message: 'Anchor KYC config saved successfully' });
    }
    catch (error) {
        console.error('Error saving anchor KYC config:', error);
        res.status(500).json({ error: 'Failed to save anchor KYC config' });
    }
});
// Get user KYC status
app.get('/api/kyc/status/:userId/:anchorId', async (req, res) => {
    try {
        const { userId, anchorId } = req.params;
        if (!userId || !anchorId) {
            return res.status(400).json({ error: 'Invalid user ID or anchor ID' });
        }
        const kycStatus = await (0, database_1.getUserKycStatus)(userId, anchorId);
        if (!kycStatus) {
            return res.status(404).json({ error: 'KYC status not found' });
        }
        res.json(kycStatus);
    }
    catch (error) {
        console.error('Error fetching KYC status:', error);
        res.status(500).json({ error: 'Failed to fetch KYC status' });
    }
});
// Register user for KYC with anchor
app.post('/api/kyc/register', async (req, res) => {
    try {
        const { userId, anchorId } = req.body;
        if (!userId || !anchorId) {
            return res.status(400).json({ error: 'Missing required fields: userId, anchorId' });
        }
        const kycService = (await Promise.resolve().then(() => __importStar(require('./kyc-service')))).KycService;
        const service = new kycService();
        await service.registerUserForKyc(userId, anchorId);
        res.json({ success: true, message: 'User registered for KYC successfully' });
    }
    catch (error) {
        console.error('Error registering user for KYC:', error);
        res.status(500).json({ error: 'Failed to register user for KYC' });
    }
});
// SEP-24: Initiate deposit/withdrawal flow
app.post('/api/anchor/initiate', async (req, res) => {
    try {
        const { user_id, anchor_id, direction, asset_code, amount, user_address, user_email } = req.body;
        // Validate required fields
        if (!user_id || typeof user_id !== 'string') {
            return res.status(400).json({ error: 'Invalid or missing user_id' });
        }
        if (!anchor_id || typeof anchor_id !== 'string') {
            return res.status(400).json({ error: 'Invalid or missing anchor_id' });
        }
        if (!direction || (direction !== 'deposit' && direction !== 'withdrawal')) {
            return res.status(400).json({ error: 'Invalid direction (must be deposit or withdrawal)' });
        }
        if (!asset_code || typeof asset_code !== 'string') {
            return res.status(400).json({ error: 'Invalid or missing asset_code' });
        }
        if (!amount || typeof amount !== 'string' || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: 'Invalid or missing amount' });
        }
        const service = await getSep24ServiceInstance();
        const request = {
            user_id,
            anchor_id,
            direction: direction,
            asset_code,
            amount,
            user_address,
            user_email,
        };
        const result = await service.initiateFlow(request);
        res.json({
            success: true,
            transaction_id: result.transaction_id,
            url: result.url,
            message: result.message,
        });
    }
    catch (error) {
        if (error instanceof Sep24ConfigError) {
            return res.status(400).json({ error: error.message, code: 'CONFIG_ERROR' });
        }
        if (error instanceof Sep24AnchorError) {
            return res.status(error.statusCode || 502).json({
                error: error.message,
                code: 'ANCHOR_ERROR'
            });
        }
        console.error('Error initiating SEP-24 flow:', error);
        res.status(500).json({ error: 'Failed to initiate transaction' });
    }
});
// SEP-24: Get transaction status
app.get('/api/anchor/transaction/:transactionId', async (req, res) => {
    try {
        const { transactionId } = req.params;
        if (!transactionId) {
            return res.status(400).json({ error: 'Invalid transaction ID' });
        }
        const service = await getSep24ServiceInstance();
        const transaction = await service.getTransactionStatus(transactionId);
        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        res.json({
            success: true,
            transaction: {
                transaction_id: transaction.transaction_id,
                anchor_id: transaction.anchor_id,
                direction: transaction.direction,
                status: transaction.status,
                asset_code: transaction.asset_code,
                amount: transaction.amount,
                amount_in: transaction.amount_in,
                amount_out: transaction.amount_out,
                amount_fee: transaction.amount_fee,
                stellar_transaction_id: transaction.stellar_transaction_id,
                external_transaction_id: transaction.external_transaction_id,
                kyc_status: transaction.kyc_status,
                created_at: transaction.created_at,
                updated_at: transaction.updated_at,
            },
        });
    }
    catch (error) {
        console.error('Error getting transaction status:', error);
        res.status(500).json({ error: 'Failed to get transaction status' });
    }
});
// Check if user is KYC approved (for transfer validation)
app.get('/api/kyc/approved/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        const kycService = (await Promise.resolve().then(() => __importStar(require('./kyc-service')))).KycService;
        const service = new kycService();
        const isApproved = await service.isUserKycApproved(userId);
        res.json({ userId, kycApproved: isApproved });
    }
    catch (error) {
        console.error('Error checking KYC approval:', error);
        res.status(500).json({ error: 'Failed to check KYC approval' });
    }
});
// Create remittance
app.post('/api/remittance', authMiddleware, async (req, res) => {
    try {
        const { sender, agent, amount, fee, expiry, memo } = req.body;
        const fromCurrency = typeof req.body.fromCurrency === 'string' ? req.body.fromCurrency : req.body.from_currency;
        const toCurrency = typeof req.body.toCurrency === 'string' ? req.body.toCurrency : req.body.to_currency;
        const maxStalenessSeconds = Number.parseInt(String(req.body.fxRateMaxStalenessSeconds ?? req.body.fx_rate_max_staleness_seconds ?? process.env.FX_RATE_MAX_STALENESS_SECONDS ?? '3600'), 10);
        if (!sender || typeof sender !== 'string') {
            return res.status(400).json({ error: 'Invalid or missing sender' });
        }
        if (!agent || typeof agent !== 'string') {
            return res.status(400).json({ error: 'Invalid or missing agent' });
        }
        if (!amount || typeof amount !== 'string' || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: 'Invalid or missing amount' });
        }
        // Validate memo — optional, max 100 chars, plain text only
        let sanitizedMemo;
        if (memo !== undefined && memo !== null && memo !== '') {
            if (typeof memo !== 'string') {
                return res.status(400).json({ error: 'memo must be a string' });
            }
            if (memo.length > 100) {
                return res.status(400).json({ error: 'memo must not exceed 100 characters' });
            }
            sanitizedMemo = (0, sanitizer_1.sanitizeInput)(memo);
        }
        if (typeof fromCurrency === 'string' && fromCurrency && typeof toCurrency === 'string' && toCurrency) {
            try {
                const fxRate = await fxRateCache.getCurrentRate(fromCurrency.toUpperCase(), toCurrency.toUpperCase());
                if (fxRate.stale && typeof fxRate.stalenessSeconds === 'number' && fxRate.stalenessSeconds > (Number.isFinite(maxStalenessSeconds) ? maxStalenessSeconds : 3600)) {
                    return res.status(409).json({
                        error: `FX rate is stale beyond the allowed maximum (${Number.isFinite(maxStalenessSeconds) ? maxStalenessSeconds : 3600}s)`,
                        fx_rate_source: fxRate.fx_rate_source || fxRate.provider,
                        fx_rate_staleness_seconds: fxRate.stalenessSeconds,
                    });
                }
            }
            catch (error) {
                logger.error('Failed to resolve FX rate for remittance', error);
                return res.status(503).json({ error: 'Unable to obtain a valid FX rate' });
            }
        }
        const remittanceId = `rem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await pool.query(`INSERT INTO transactions
         (transaction_id, anchor_id, kind, status, amount_in, memo, created_at, updated_at)
       VALUES ($1, $2, 'withdrawal', 'pending_user_transfer_start', $3, $4, NOW(), NOW())`, [remittanceId, agent, amount, sanitizedMemo ?? null]);
        return res.status(201).json({
            success: true,
            remittance: {
                remittance_id: remittanceId,
                sender,
                agent,
                amount,
                fee: fee ?? null,
                expiry: expiry ?? null,
                memo: sanitizedMemo ?? null,
                status: 'pending_user_transfer_start',
            },
        });
    }
    catch (error) {
        logger.error('Error creating remittance', error);
        return res.status(500).json({ error: 'Failed to create remittance' });
    }
});
// Get remittance by ID
app.get('/api/remittance/:remittanceId', async (req, res) => {
    try {
        const { remittanceId } = req.params;
        const result = await pool.query(`SELECT transaction_id, anchor_id, status, amount_in, memo, created_at, updated_at
         FROM transactions WHERE transaction_id = $1`, [remittanceId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Remittance not found' });
        }
        const row = result.rows[0];
        return res.json({
            remittance_id: row.transaction_id,
            agent: row.anchor_id,
            status: row.status,
            amount: row.amount_in,
            memo: row.memo ?? null,
            created_at: row.created_at,
            updated_at: row.updated_at,
        });
    }
    catch (error) {
        logger.error('Error fetching remittance', error);
        return res.status(500).json({ error: 'Failed to fetch remittance' });
    }
});
// Simulate settlement — preview fees and payout before confirming
app.post('/api/simulate-settlement', async (req, res) => {
    try {
        const { remittanceId } = req.body;
        if (remittanceId === undefined ||
            remittanceId === null ||
            !Number.isInteger(remittanceId) ||
            remittanceId <= 0) {
            return res.status(400).json({ error: 'remittanceId must be a positive integer' });
        }
        const simulation = await (0, stellar_1.simulateSettlement)(remittanceId);
        res.json(simulation);
    }
    catch (error) {
        console.error('Error simulating settlement:', error);
        res.status(500).json({ error: 'Failed to simulate settlement' });
    }
});
exports.default = app;
