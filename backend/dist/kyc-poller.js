"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KycPoller = void 0;
const anchor_kyc_client_1 = require("./anchor-kyc-client");
class KycPoller {
    pool;
    upsertService;
    delayMs;
    constructor(pool, upsertService, delayMs = 1000) {
        this.pool = pool;
        this.upsertService = upsertService;
        this.delayMs = delayMs;
    }
    /**
     * Run one full poll cycle across all enabled anchors that have a kyc_endpoint configured.
     */
    async runCycle() {
        const result = await this.pool.query(`SELECT id, kyc_endpoint, webhook_secret
       FROM anchors
       WHERE enabled = true AND kyc_endpoint IS NOT NULL`);
        const anchors = result.rows;
        let updated = 0;
        let errors = 0;
        for (const anchor of anchors) {
            try {
                const client = new anchor_kyc_client_1.AnchorKycClient({
                    anchor_id: anchor.id,
                    kyc_endpoint: anchor.kyc_endpoint,
                    webhook_secret: anchor.webhook_secret ?? '',
                });
                const records = await client.fetchKycStatuses();
                for (const record of records) {
                    try {
                        await this.upsertService.upsert(record);
                        updated++;
                    }
                    catch (recordErr) {
                        console.warn('Skipping invalid KYC record', { anchor_id: anchor.id, error: recordErr });
                        errors++;
                    }
                }
            }
            catch (anchorErr) {
                console.error('KYC poll failed for anchor', { anchor_id: anchor.id, error: anchorErr });
                errors++;
            }
            // Rate-limit between anchor calls
            if (this.delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, this.delayMs));
            }
        }
        console.log('KYC poll cycle complete', { updated, errors });
        return { updated, errors };
    }
}
exports.KycPoller = KycPoller;
