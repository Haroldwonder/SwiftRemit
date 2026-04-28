import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import * as schemas from './schemas/openapi';

const registry = new OpenAPIRegistry();

export function generateOpenAPISpec() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
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
