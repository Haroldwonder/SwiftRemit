"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const api_1 = __importDefault(require("./api"));
const database_1 = require("./database");
const scheduler_1 = require("./scheduler");
const webhook_handler_1 = require("./webhook-handler");
const kyc_service_1 = require("./kyc-service");
dotenv_1.default.config();
const PORT = process.env.PORT || 3000;
async function start() {
    try {
        // Initialize database
        await (0, database_1.initDatabase)();
        console.log('Database initialized');
        // Initialize KYC service
        const kycService = new kyc_service_1.KycService();
        await kycService.initialize();
        console.log('KYC service initialized');
        // Setup webhook handler
        const pool = (0, database_1.getPool)();
        const webhookHandler = new webhook_handler_1.WebhookHandler(pool);
        webhookHandler.setupRoutes(api_1.default);
        webhookHandler.setupHealthCheck(api_1.default);
        console.log('Webhook endpoints configured');
        // Start background jobs
        (0, scheduler_1.startBackgroundJobs)();
        // Start API server
        api_1.default.listen(PORT, () => {
            console.log(`SwiftRemit Verification Service running on port ${PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
        });
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}
start();
