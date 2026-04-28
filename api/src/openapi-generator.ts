import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import {
  CurrencySchema,
  CurrencyResponseSchema,
  ErrorResponseSchema,
  AnchorProviderSchema,
  AnchorListResponseSchema,
  AnchorDetailResponseSchema,
  HealthResponseSchema,
} from './schemas/openapi';

const registry = new OpenAPIRegistry();

// Register schemas
registry.register('Currency', CurrencySchema);
registry.register('CurrencyResponse', CurrencyResponseSchema);
registry.register('ErrorResponse', ErrorResponseSchema);
registry.register('AnchorProvider', AnchorProviderSchema);
registry.register('AnchorListResponse', AnchorListResponseSchema);
registry.register('AnchorDetailResponse', AnchorDetailResponseSchema);
registry.register('HealthResponse', HealthResponseSchema);

// Health check endpoint
registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  summary: 'Health check endpoint',
  responses: {
    200: {
      description: 'Service is healthy',
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

// Currency endpoints
registry.registerPath({
  method: 'get',
  path: '/api/currencies',
  tags: ['Currencies'],
  summary: 'Get all supported currencies',
  description: 'Returns all supported currencies with their formatting rules',
  responses: {
    200: {
      description: 'List of currencies',
      content: {
        'application/json': {
          schema: CurrencyResponseSchema,
        },
      },
    },
    500: {
      description: 'Server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/currencies/{code}',
  tags: ['Currencies'],
  summary: 'Get currency by code',
  description: 'Returns a specific currency by its code',
  request: {
    params: CurrencySchema.pick({ code: true }),
  },
  responses: {
    200: {
      description: 'Currency details',
      content: {
        'application/json': {
          schema: CurrencyResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid currency code',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Currency not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Anchor endpoints
registry.registerPath({
  method: 'get',
  path: '/api/anchors',
  tags: ['Anchors'],
  summary: 'Get all anchor providers',
  description: 'Returns all available anchor providers with optional filtering',
  request: {
    query: CurrencySchema.pick({ code: true }).extend({
      status: AnchorProviderSchema.shape.status.optional(),
      currency: CurrencySchema.shape.code.optional(),
    }).partial(),
  },
  responses: {
    200: {
      description: 'List of anchor providers',
      content: {
        'application/json': {
          schema: AnchorListResponseSchema,
        },
      },
    },
    500: {
      description: 'Server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/anchors/{id}',
  tags: ['Anchors'],
  summary: 'Get anchor by ID',
  description: 'Returns a specific anchor provider by ID',
  request: {
    params: AnchorProviderSchema.pick({ id: true }),
  },
  responses: {
    200: {
      description: 'Anchor details',
      content: {
        'application/json': {
          schema: AnchorDetailResponseSchema,
        },
      },
    },
    404: {
      description: 'Anchor not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/anchors/admin',
  tags: ['Anchors'],
  summary: 'Create new anchor (Admin)',
  description: 'Creates a new anchor provider. Requires admin API key.',
  security: [{ ApiKeyAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: AnchorProviderSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Anchor created successfully',
      content: {
        'application/json': {
          schema: AnchorDetailResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid anchor payload',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

export function generateOpenAPISpec() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'SwiftRemit API Service',
      version: '1.0.0',
      description: 'API service for SwiftRemit currency configuration and anchor management',
      contact: {
        name: 'SwiftRemit Team',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
      {
        url: 'https://api.swiftremit.com',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Admin API key for protected endpoints',
        },
      },
    },
    tags: [
      {
        name: 'Health',
        description: 'Health check endpoints',
      },
      {
        name: 'Currencies',
        description: 'Currency configuration endpoints',
      },
      {
        name: 'Anchors',
        description: 'Anchor provider management endpoints',
      },
    ],
  });
}
