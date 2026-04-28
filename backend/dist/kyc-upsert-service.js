"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KycUpsertService = exports.ValidationError = void 0;
const stellar_kyc_1 = require("./stellar-kyc");
const VALID_STATUSES = ['pending', 'approved', 'rejected'];
class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
class KycUpsertService {
    pool;
    onChainSync;
    constructor(pool, onChainSync = stellar_kyc_1.setKycApprovedOnChain) {
        this.pool = pool;
        this.onChainSync = onChainSync;
    }
    /**
     * Upsert a KYC record into user_kyc_status.
     * Last-write-wins: only updates if the incoming verified_at is newer.
     * Throws ValidationError for unrecognised kyc_status values.
     */
    async upsert(record) {
        if (!VALID_STATUSES.includes(record.kyc_status)) {
            throw new ValidationError(`Invalid kyc_status "${record.kyc_status}". Must be one of: ${VALID_STATUSES.join(', ')}`);
        }
        const result = await this.pool.query(`INSERT INTO user_kyc_status
         (user_id, anchor_id, kyc_status, kyc_level, rejection_reason, verified_at, expires_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id, anchor_id) DO UPDATE
         SET kyc_status       = EXCLUDED.kyc_status,
             kyc_level        = EXCLUDED.kyc_level,
             rejection_reason = EXCLUDED.rejection_reason,
             verified_at      = EXCLUDED.verified_at,
             expires_at       = EXCLUDED.expires_at,
             updated_at       = NOW()
         WHERE user_kyc_status.verified_at < EXCLUDED.verified_at`, [
            record.user_id,
            record.anchor_id,
            record.kyc_status,
            record.kyc_level ?? null,
            record.rejection_reason ?? null,
            record.verified_at,
            record.expires_at ?? null,
        ]);
        if (result.rowCount === 0) {
            return;
        }
        if (record.kyc_status === 'approved') {
            try {
                await this.onChainSync(record.user_id, true, record.expires_at);
            }
            catch (error) {
                console.error('Failed to sync KYC approval to smart contract', {
                    user_address: record.user_id,
                    error,
                });
            }
            return;
        }
        if (record.kyc_status === 'rejected') {
            try {
                await this.onChainSync(record.user_id, false);
            }
            catch (error) {
                console.error('Failed to sync KYC rejection to smart contract', {
                    user_address: record.user_id,
                    error,
                });
            }
        }
    }
    /**
     * Return the aggregated KYC status for a user across all anchors.
     * A user can transfer if at least one non-expired approved record exists.
     */
    async getStatusForUser(userId) {
        const result = await this.pool.query(`SELECT anchor_id, kyc_status, kyc_level, verified_at, expires_at, rejection_reason
       FROM user_kyc_status
       WHERE user_id = $1
       ORDER BY verified_at DESC`, [userId]);
        const now = new Date();
        const rows = result.rows;
        if (rows.length === 0) {
            return {
                overall_status: 'pending',
                can_transfer: false,
                reason: 'no_kyc_record',
                anchors: [],
                last_checked: now,
            };
        }
        const anchors = rows.map(r => ({
            anchor_id: r.anchor_id,
            kyc_status: r.kyc_status,
            kyc_level: r.kyc_level ?? undefined,
            verified_at: r.verified_at,
            expires_at: r.expires_at ?? undefined,
            rejection_reason: r.rejection_reason ?? undefined,
        }));
        // Check for at least one non-expired approved record
        const hasApproved = rows.some(r => r.kyc_status === 'approved' && (!r.expires_at || r.expires_at > now));
        if (hasApproved) {
            return { overall_status: 'approved', can_transfer: true, anchors, last_checked: now };
        }
        // Check for expired approved record
        const hasExpired = rows.some(r => r.kyc_status === 'approved' && r.expires_at && r.expires_at <= now);
        if (hasExpired) {
            return { overall_status: 'rejected', can_transfer: false, reason: 'kyc_expired', anchors, last_checked: now };
        }
        // Check for rejected
        const hasRejected = rows.some(r => r.kyc_status === 'rejected');
        if (hasRejected) {
            return { overall_status: 'rejected', can_transfer: false, reason: 'kyc_rejected', anchors, last_checked: now };
        }
        // All pending
        return { overall_status: 'pending', can_transfer: false, reason: 'kyc_pending', anchors, last_checked: now };
    }
}
exports.KycUpsertService = KycUpsertService;
