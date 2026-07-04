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
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOpenAPISpec = generateOpenAPISpec;
const zod_to_openapi_1 = require("@asteasolutions/zod-to-openapi");
const schemas = __importStar(require("./schemas/openapi"));
const registry = new zod_to_openapi_1.OpenAPIRegistry();
function generateOpenAPISpec() {
    const generator = new zod_to_openapi_1.OpenApiGeneratorV3(registry.definitions);
    return generator.generateDocument({
        openapi: '3.0.0',
        info: {
            title: 'SwiftRemit Backend Service',
            version: '1.0.0',
            description: 'Asset verification, KYC, and webhook handling service',
        },
        servers: [
            { url: 'http://localhost:3001', description: 'Development' },
            { url: 'https://backend.swiftremit.com', description: 'Production' },
        ],
    });
}
// Health check
registry.registerPath({
    method: 'get',
    path: '/health',
    tags: ['Health'],
    summary: 'Health check endpoint',
    responses: {
        200: { description: 'Service is healthy', content: { 'application/json': { schema: schemas.HealthResponseSchema } } },
    },
});
// Asset Verification endpoints
registry.registerPath({
    method: 'get',
    path: '/api/verification/{assetCode}/{issuer}',
    tags: ['Asset Verification'],
    summary: 'Get asset verification status',
    request: { params: schemas.AssetVerificationSchema.pick({ asset_code: true, issuer: true }) },
    responses: {
        200: { description: 'Asset verification details', content: { 'application/json': { schema: schemas.AssetVerificationSchema } } },
        400: { description: 'Invalid input', content: { 'application/json': { schema: schemas.ErrorResponseSchema } } },
        404: { description: 'Asset not found', content: { 'application/json': { schema: schemas.ErrorResponseSchema } } },
        500: { description: 'Server error', content: { 'application/json': { schema: schemas.ErrorResponseSchema } } },
    },
});
registry.registerPath({
    method: 'post',
    path: '/api/verification/verify',
    tags: ['Asset Verification'],
    summary: 'Verify an asset',
    request: { body: { content: { 'application/json': { schema: schemas.VerifyAssetRequestSchema } } } },
    responses: {
        200: { description: 'Verification completed', content: { 'application/json': { schema: schemas.SuccessResponseSchema } } },
        400: { description: 'Invalid input', content: { 'application/json': { schema: schemas.ErrorResponseSchema } } },
        500: { description: 'Verification failed', content: { 'application/json': { schema: schemas.ErrorResponseSchema } } },
    },
});
registry.registerPath({
    method: 'post',
    path: '/api/verification/report',
    tags: ['Asset Verification'],
    summary: 'Report suspicious asset',
    request: { body: { content: { 'application/json': { schema: schemas.ReportAssetRequestSchema } } } },
    responses: {
        200: { description: 'Report submitted', content: { 'application/json': { schema: schemas.SuccessResponseSchema } } },
        400: { description: 'Invalid input', content: { 'application/json': { schema: schemas.ErrorResponseSchema } } },
        404: { description: 'Asset not found', content: { 'application/json': { schema: schemas.ErrorResponseSchema } } },
        500: { description: 'Server error', content: { 'application/json': { schema: schemas.ErrorResponseSchema } } },
    },
});
registry.registerPath({
    method: 'get',
    path: '/api/verification/verified',
    tags: ['Asset Verification'],
    summary: 'List verified assets',
    responses: {
        200: { description: 'List of verified assets', content: { 'application/json': { schema: schemas.SuccessResponseSchema } } },
        500: { description: 'Server error', content: { 'application/json': { schema: schemas.ErrorResponseSchema } } },
    },
});
registry.registerPath({
    method: 'post',
    path: '/api/verification/batch',
    tags: ['Asset Verification'],
    summary: 'Batch verification status',
    request: { body: { content: { 'application/json': { schema: schemas.BatchVerificationRequestSchema } } } },
    responses: {
        200: { description: 'Batch results', content: { 'application/json': { schema: schemas.BatchVerificationResponseSchema } } },
        400: { description: 'Invalid input', content: { 'application/json': { schema: schemas.ErrorResponseSchema } } },
        500: { description: 'Server error', content: { 'application/json': { schema: schemas.ErrorResponseSchema } } },
    },
});
