"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthResponseSchema = exports.WebhookResponseSchema = exports.WebhookEventSchema = exports.FxRateRecordSchema = exports.FxRateRequestSchema = exports.UserKycStatusSchema = exports.AnchorKycRecordSchema = exports.KycLevelSchema = exports.KycStatusSchema = exports.BatchVerificationResponseSchema = exports.BatchVerificationRequestSchema = exports.ReportAssetRequestSchema = exports.VerifyAssetRequestSchema = exports.AssetVerificationSchema = exports.VerificationStatusSchema = exports.SuccessResponseSchema = exports.ErrorResponseSchema = void 0;
const zod_1 = require("zod");
const zod_to_openapi_1 = require("@asteasolutions/zod-to-openapi");
(0, zod_to_openapi_1.extendZodWithOpenApi)(zod_1.z);
// Common schemas
exports.ErrorResponseSchema = zod_1.z.object({
    error: zod_1.z.string(),
}).openapi('ErrorResponse');
exports.SuccessResponseSchema = zod_1.z.object({
    success: zod_1.z.boolean(),
    message: zod_1.z.string().optional(),
}).openapi('SuccessResponse');
// Asset Verification schemas
exports.VerificationStatusSchema = zod_1.z.enum(['verified', 'unverified', 'suspicious']).openapi('VerificationStatus');
exports.AssetVerificationSchema = zod_1.z.object({
    asset_code: zod_1.z.string().max(12).openapi({ example: 'USDC' }),
    issuer: zod_1.z.string().length(56).openapi({ example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' }),
    status: exports.VerificationStatusSchema,
    reputation_score: zod_1.z.number().int().min(0).max(100),
    last_verified: zod_1.z.string().datetime(),
    trustline_count: zod_1.z.number().int(),
    has_toml: zod_1.z.boolean(),
    stellar_expert_verified: zod_1.z.boolean().optional(),
    toml_data: zod_1.z.any().optional(),
    community_reports: zod_1.z.number().int().optional(),
}).openapi('AssetVerification');
exports.VerifyAssetRequestSchema = zod_1.z.object({
    assetCode: zod_1.z.string().max(12),
    issuer: zod_1.z.string().length(56),
}).openapi('VerifyAssetRequest');
exports.ReportAssetRequestSchema = zod_1.z.object({
    assetCode: zod_1.z.string().max(12),
    issuer: zod_1.z.string().length(56),
    reason: zod_1.z.string().max(500),
}).openapi('ReportAssetRequest');
exports.BatchVerificationRequestSchema = zod_1.z.object({
    assets: zod_1.z.array(zod_1.z.object({
        assetCode: zod_1.z.string().max(12),
        issuer: zod_1.z.string().length(56),
    })).min(1).max(50),
}).openapi('BatchVerificationRequest');
exports.BatchVerificationResponseSchema = zod_1.z.object({
    results: zod_1.z.array(zod_1.z.object({
        assetCode: zod_1.z.string(),
        issuer: zod_1.z.string(),
        verification: exports.AssetVerificationSchema.nullable(),
        error: zod_1.z.string().optional(),
    })),
}).openapi('BatchVerificationResponse');
// KYC schemas
exports.KycStatusSchema = zod_1.z.enum(['pending', 'approved', 'rejected', 'expired']).openapi('KycStatus');
exports.KycLevelSchema = zod_1.z.enum(['basic', 'intermediate', 'advanced']).openapi('KycLevel');
exports.AnchorKycRecordSchema = zod_1.z.object({
    anchor_id: zod_1.z.string(),
    kyc_status: exports.KycStatusSchema,
    kyc_level: exports.KycLevelSchema.optional(),
    verified_at: zod_1.z.string().datetime(),
    expires_at: zod_1.z.string().datetime().optional(),
    rejection_reason: zod_1.z.string().optional(),
}).openapi('AnchorKycRecord');
exports.UserKycStatusSchema = zod_1.z.object({
    can_transfer: zod_1.z.boolean(),
    reason: zod_1.z.string().optional(),
    anchors: zod_1.z.array(exports.AnchorKycRecordSchema),
}).openapi('UserKycStatus');
// FX Rate schemas
exports.FxRateRequestSchema = zod_1.z.object({
    transactionId: zod_1.z.string(),
    rate: zod_1.z.number().positive(),
    provider: zod_1.z.string(),
    fromCurrency: zod_1.z.string(),
    toCurrency: zod_1.z.string(),
}).openapi('FxRateRequest');
exports.FxRateRecordSchema = zod_1.z.object({
    id: zod_1.z.number().int(),
    transaction_id: zod_1.z.string(),
    rate: zod_1.z.number(),
    provider: zod_1.z.string(),
    timestamp: zod_1.z.string().datetime(),
    from_currency: zod_1.z.string(),
    to_currency: zod_1.z.string(),
    created_at: zod_1.z.string().datetime(),
}).openapi('FxRateRecord');
// Webhook schemas
exports.WebhookEventSchema = zod_1.z.object({
    event_type: zod_1.z.string().openapi({ example: 'transaction.completed' }),
    transaction_id: zod_1.z.string(),
    timestamp: zod_1.z.string().datetime(),
    data: zod_1.z.any(),
}).openapi('WebhookEvent');
exports.WebhookResponseSchema = zod_1.z.object({
    received: zod_1.z.boolean(),
    webhook_id: zod_1.z.string(),
}).openapi('WebhookResponse');
// Health check schema
exports.HealthResponseSchema = zod_1.z.object({
    status: zod_1.z.string().openapi({ example: 'ok' }),
    timestamp: zod_1.z.string().datetime(),
}).openapi('HealthResponse');
