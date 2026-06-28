"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sep24Service = exports.Sep24AnchorError = exports.Sep24TimeoutError = exports.Sep24ConfigError = void 0;
exports.createSep24Service = createSep24Service;
const axios_1 = __importDefault(require("axios"));
const database_1 = require("./database");
/**
 * Configuration error
 */
class Sep24ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'Sep24ConfigError';
    }
}
exports.Sep24ConfigError = Sep24ConfigError;
/**
 * Anchor timeout error
 */
class Sep24TimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = 'Sep24TimeoutError';
    }
}
exports.Sep24TimeoutError = Sep24TimeoutError;
/**
 * Anchor communication error
 */
class Sep24AnchorError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'Sep24AnchorError';
    }
}
exports.Sep24AnchorError = Sep24AnchorError;
/**
 * SEP-24 Service for handling deposit/withdrawal flows
 */
class Sep24Service {
    pool;
    anchorConfigs = new Map();
    httpClient;
    constructor(pool) {
        this.pool = pool;
        this.httpClient = axios_1.default.create({
            timeout: 30000, // 30 second timeout for SEP-24 requests
        });
    }
    /**
     * Initialize the SEP-24 service with anchor configurations
     */
    async initialize() {
        const kycConfigs = await (0, database_1.getAnchorKycConfigs)();
        // Load SEP-24 configurations from environment
        for (const config of kycConfigs) {
            const sep24Enabled = process.env[`SEP24_ENABLED_${config.anchor_id.toUpperCase()}`] === 'true';
            const sepServerUrl = process.env[`SEP24_SERVER_${config.anchor_id.toUpperCase()}`] || config.kyc_server_url;
            if (sep24Enabled && sepServerUrl) {
                const anchorConfig = {
                    anchor_id: config.anchor_id,
                    sep_server_url: sepServerUrl,
                    sep24_enabled: true,
                    webauth_domain: new URL(sepServerUrl).host,
                    webhook_url: process.env[`SEP24_WEBHOOK_${config.anchor_id.toUpperCase()}`],
                    polling_interval_minutes: parseInt(process.env[`SEP24_POLL_INTERVAL_${config.anchor_id.toUpperCase()}`] || '5'),
                    timeout_minutes: parseInt(process.env[`SEP24_TIMEOUT_${config.anchor_id.toUpperCase()}`] || '30'),
                };
                this.anchorConfigs.set(config.anchor_id, anchorConfig);
            }
        }
        console.log(`Initialized SEP-24 service with ${this.anchorConfigs.size} enabled anchors`);
    }
    /**
     * Initiate a SEP-24 deposit or withdrawal flow
     */
    async initiateFlow(request) {
        const { user_id, anchor_id, direction, asset_code, amount, user_address, user_email } = request;
        // Get anchor configuration
        const anchorConfig = this.anchorConfigs.get(anchor_id);
        if (!anchorConfig) {
            throw new Sep24ConfigError(`Anchor ${anchor_id} is not configured for SEP-24`);
        }
        if (!anchorConfig.sep24_enabled) {
            throw new Sep24ConfigError(`SEP-24 is not enabled for anchor ${anchor_id}`);
        }
        // Generate transaction ID
        const transactionId = `${anchor_id}-${direction}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        try {
            // Call anchor's SEP-24 deposit or withdraw endpoint
            const endpoint = direction === 'deposit' ? 'deposit' : 'withdraw';
            const url = `${anchorConfig.sep_server_url}/${endpoint}`;
            const requestBody = {
                asset_code: asset_code,
                amount: amount,
                transaction_id: transactionId,
                lang: 'en',
            };
            // Add user identification
            if (user_address) {
                requestBody.account = user_address;
            }
            if (user_email) {
                requestBody.email = user_email;
            }
            // Add callback for webhook (if configured)
            if (anchorConfig.webhook_url) {
                requestBody.callback_url = `${anchorConfig.webhook_url}?transaction_id=${transactionId}`;
            }
            console.log(`Initiating SEP-24 ${direction} for anchor ${anchor_id}, transaction ${transactionId}`);
            const response = await this.httpClient.post(url, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                // Allow 302 redirect to capture interactive URL
                maxRedirects: 5,
            });
            const data = response.data;
            // Store transaction in database
            const transactionRecord = {
                transaction_id: data.transaction_id || transactionId,
                anchor_id: anchor_id,
                direction: direction,
                status: 'pending_anchor',
                asset_code: asset_code,
                amount: amount,
                user_id: user_id,
                interactive_url: data.interactive_url || data.url,
                instructions_url: data.instructions_url,
                kyc_status: data.kyc_web_url ? 'pending' : 'not_required',
                kyc_web_url: data.kyc_web_url,
            };
            await (0, database_1.saveSep24Transaction)(transactionRecord);
            return {
                transaction_id: data.transaction_id || transactionId,
                url: data.interactive_url || data.url,
                message: data.instructions_url || 'Follow the link to complete the transaction',
            };
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error)) {
                const statusCode = error.response?.status;
                const errorMessage = error.response?.data?.error || error.message;
                // Store failed transaction for tracking
                await (0, database_1.saveSep24Transaction)({
                    transaction_id: transactionId,
                    anchor_id: anchor_id,
                    direction: direction,
                    status: 'error',
                    asset_code: asset_code,
                    amount: amount,
                    user_id: user_id,
                });
                throw new Sep24AnchorError(`Failed to initiate ${direction}: ${errorMessage}`, statusCode);
            }
            throw error;
        }
    }
    /**
     * Poll all pending SEP-24 transactions for status updates
     */
    async pollAllTransactions() {
        for (const [anchorId, config] of this.anchorConfigs) {
            try {
                await this.pollAnchorTransactions(anchorId, config);
            }
            catch (error) {
                console.error(`Failed to poll transactions for anchor ${anchorId}:`, error);
            }
        }
    }
    /**
     * Poll transactions for a specific anchor
     */
    async pollAnchorTransactions(anchorId, config) {
        // Get pending transactions for this anchor
        const pendingTransactions = await (0, database_1.getPendingSep24Transactions)(anchorId, config.polling_interval_minutes);
        console.log(`Polling ${pendingTransactions.length} transactions for anchor ${anchorId}`);
        for (const transaction of pendingTransactions) {
            try {
                // Check for timeout
                const createdAt = transaction.created_at || new Date();
                const timeSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60);
                if (timeSinceCreation > config.timeout_minutes) {
                    // Mark as expired
                    await (0, database_1.updateSep24TransactionStatus)(transaction.transaction_id, 'expired');
                    console.log(`Transaction ${transaction.transaction_id} marked as expired`);
                    continue;
                }
                // Query anchor for status
                const statusResponse = await this.queryTransactionStatus(config.sep_server_url, transaction.transaction_id);
                if (statusResponse) {
                    const { transaction: txn } = statusResponse;
                    // Map anchor status to our status
                    const newStatus = this.mapAnchorStatusToInternal(txn.status);
                    // Update if status changed
                    if (newStatus !== transaction.status) {
                        await (0, database_1.updateSep24TransactionStatus)(transaction.transaction_id, newStatus, txn.amount_in, txn.amount_out, txn.amount_fee, txn.stellar_transaction_id, txn.external_transaction_id, txn.message);
                        console.log(`Transaction ${transaction.transaction_id} updated to ${newStatus}`);
                    }
                }
                // Rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            catch (error) {
                console.error(`Failed to poll transaction ${transaction.transaction_id}:`, error);
            }
        }
    }
    /**
     * Query transaction status from anchor
     */
    async queryTransactionStatus(sepServerUrl, transactionId) {
        try {
            const url = `${sepServerUrl}/transaction?id=${transactionId}`;
            const response = await this.httpClient.get(url, {
                headers: {
                    'Accept': 'application/json',
                },
                timeout: 10000,
            });
            return response.data;
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error)) {
                if (error.response?.status === 404) {
                    return null;
                }
                console.error(`HTTP error querying transaction status: ${error.response?.status}`);
            }
            return null;
        }
    }
    /**
     * Map anchor status to our internal status
     */
    mapAnchorStatusToInternal(anchorStatus) {
        // SEP-24 status mapping
        const statusMap = {
            'pending_user_transfer_start': 'pending_user_transfer_start',
            'pending_anchor': 'pending_anchor',
            'pending_stellar': 'pending_stellar',
            'pending_external': 'pending_external',
            'pending_trust': 'pending_trust',
            'pending_user': 'pending_user',
            'completed': 'completed',
            'refunded': 'refunded',
            'expired': 'expired',
            'error': 'error',
        };
        return statusMap[anchorStatus] || 'error';
    }
    /**
     * Get transaction status
     */
    async getTransactionStatus(transactionId) {
        const record = await (0, database_1.getSep24TransactionById)(transactionId);
        if (!record)
            return null;
        // Transform database record to proper types
        return {
            transaction_id: record.transaction_id,
            anchor_id: record.anchor_id,
            direction: record.direction,
            status: record.status,
            asset_code: record.asset_code,
            amount: record.amount,
            amount_in: record.amount_in,
            amount_out: record.amount_out,
            amount_fee: record.amount_fee,
            stellar_transaction_id: record.stellar_transaction_id,
            external_transaction_id: record.external_transaction_id,
            user_id: record.user_id,
            interactive_url: record.interactive_url,
            instructions_url: record.instructions_url,
            kyc_status: record.kyc_status,
            kyc_web_url: record.kyc_web_url,
            status_eta: record.status_eta,
            last_polled: record.last_polled,
            created_at: record.created_at,
            updated_at: record.updated_at,
        };
    }
    /**
     * Handle webhook notification for transaction completion
     */
    async handleWebhookNotification(payload) {
        const { transaction_id, status } = payload;
        const newStatus = this.mapAnchorStatusToInternal(status);
        await (0, database_1.updateSep24TransactionStatus)(transaction_id, newStatus, payload.amount_in, payload.amount_out, payload.amount_fee, payload.stellar_transaction_id, payload.external_transaction_id, payload.message);
        console.log(`Transaction ${transaction_id} updated via webhook to ${newStatus}`);
    }
}
exports.Sep24Service = Sep24Service;
/**
 * Create a new SEP-24 service instance
 */
function createSep24Service(pool) {
    return new Sep24Service(pool);
}
