const fs = require('fs');

const spec = {
  openapi: '3.0.0',
  info: {
    title: 'SwiftRemit Backend Service',
    version: '1.0.0',
    description: 'Asset verification, KYC, and webhook handling service for SwiftRemit'
  },
  servers: [
    { url: 'http://localhost:3001', description: 'Development server' },
    { url: 'https://backend.swiftremit.com', description: 'Production server' }
  ],
  tags: [
    { name: 'Health' },
    { name: 'Asset Verification' },
    { name: 'KYC' },
    { name: 'Transfer' },
    { name: 'FX Rates' },
    { name: 'Webhooks' }
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check endpoint',
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/verification/{assetCode}/{issuer}': {
      get: {
        tags: ['Asset Verification'],
        summary: 'Get asset verification status',
        parameters: [
          { name: 'assetCode', in: 'path', required: true, schema: { type: 'string', maxLength: 12 } },
          { name: 'issuer', in: 'path', required: true, schema: { type: 'string', minLength: 56, maxLength: 56 } }
        ],
        responses: {
          '200': { description: 'Asset verification details', content: { 'application/json': { schema: { $ref: '#/components/schemas/AssetVerification' } } } },
          '400': { $ref: '#/components/responses/BadRequest' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },
    '/api/verification/verify': {
      post: {
        tags: ['Asset Verification'],
        summary: 'Verify an asset',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['assetCode', 'issuer'],
                properties: {
                  assetCode: { type: 'string', maxLength: 12 },
                  issuer: { type: 'string', minLength: 56, maxLength: 56 }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Verification completed' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },
    '/api/kyc/status': {
      get: {
        tags: ['KYC'],
        summary: 'Get KYC status',
        security: [{ UserAuth: [] }],
        responses: {
          '200': { description: 'KYC status', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserKycStatus' } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },
    '/api/transfer': {
      post: {
        tags: ['Transfer'],
        summary: 'Initiate transfer',
        security: [{ UserAuth: [] }],
        responses: {
          '200': { description: 'Transfer allowed' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { description: 'KYC not approved' }
        }
      }
    },
    '/api/fx-rate': {
      post: {
        tags: ['FX Rates'],
        summary: 'Store FX rate',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['transactionId', 'rate', 'provider', 'fromCurrency', 'toCurrency'],
                properties: {
                  transactionId: { type: 'string' },
                  rate: { type: 'number', minimum: 0 },
                  provider: { type: 'string' },
                  fromCurrency: { type: 'string' },
                  toCurrency: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'FX rate stored' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },
    '/api/webhook': {
      post: {
        tags: ['Webhooks'],
        summary: 'Receive webhook',
        security: [{ WebhookSignature: [] }],
        responses: {
          '200': { description: 'Webhook received' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { description: 'Invalid signature' }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      UserAuth: { type: 'apiKey', in: 'header', name: 'x-user-id' },
      WebhookSignature: { type: 'apiKey', in: 'header', name: 'x-signature' }
    },
    responses: {
      BadRequest: { description: 'Invalid input', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      Unauthorized: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      NotFound: { description: 'Resource not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      ServerError: { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' }
        }
      },
      AssetVerification: {
        type: 'object',
        properties: {
          asset_code: { type: 'string' },
          issuer: { type: 'string' },
          status: { type: 'string', enum: ['verified', 'unverified', 'suspicious'] },
          reputation_score: { type: 'integer', minimum: 0, maximum: 100 },
          last_verified: { type: 'string', format: 'date-time' },
          trustline_count: { type: 'integer' },
          has_toml: { type: 'boolean' }
        }
      },
      UserKycStatus: {
        type: 'object',
        properties: {
          can_transfer: { type: 'boolean' },
          reason: { type: 'string' },
          anchors: { type: 'array', items: { type: 'object' } }
        }
      }
    }
  }
};

// Convert to YAML-like format
const yaml = require('js-yaml');
const yamlStr = yaml.dump(spec, { indent: 2, lineWidth: -1 });

fs.writeFileSync('openapi.yaml', yamlStr, 'utf8');
console.log('✅ Backend OpenAPI spec generated successfully!');
