import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

describe('OpenAPI Specification', () => {
  it('should have a valid openapi.yaml file', () => {
    const openApiPath = join(__dirname, '../../openapi.yaml');
    const fileContents = readFileSync(openApiPath, 'utf8');
    const spec = yaml.load(fileContents) as any;

    expect(spec).toBeDefined();
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBe('SwiftRemit API Service');
    expect(spec.paths).toBeDefined();
  });

  it('should document all currency endpoints', () => {
    const openApiPath = join(__dirname, '../../openapi.yaml');
    const fileContents = readFileSync(openApiPath, 'utf8');
    const spec = yaml.load(fileContents) as any;

    expect(spec.paths['/api/currencies']).toBeDefined();
    expect(spec.paths['/api/currencies'].get).toBeDefined();
    expect(spec.paths['/api/currencies/{code}']).toBeDefined();
    expect(spec.paths['/api/currencies/{code}'].get).toBeDefined();
  });

  it('should document all anchor endpoints', () => {
    const openApiPath = join(__dirname, '../../openapi.yaml');
    const fileContents = readFileSync(openApiPath, 'utf8');
    const spec = yaml.load(fileContents) as any;

    expect(spec.paths['/api/anchors']).toBeDefined();
    expect(spec.paths['/api/anchors'].get).toBeDefined();
    expect(spec.paths['/api/anchors/{id}']).toBeDefined();
    expect(spec.paths['/api/anchors/{id}'].get).toBeDefined();
    expect(spec.paths['/api/anchors/admin']).toBeDefined();
    expect(spec.paths['/api/anchors/admin'].post).toBeDefined();
  });

  it('should document health check endpoint', () => {
    const openApiPath = join(__dirname, '../../openapi.yaml');
    const fileContents = readFileSync(openApiPath, 'utf8');
    const spec = yaml.load(fileContents) as any;

    expect(spec.paths['/health']).toBeDefined();
    expect(spec.paths['/health'].get).toBeDefined();
  });

  it('should define all required schemas', () => {
    const openApiPath = join(__dirname, '../../openapi.yaml');
    const fileContents = readFileSync(openApiPath, 'utf8');
    const spec = yaml.load(fileContents) as any;

    const schemas = spec.components.schemas;
    expect(schemas.Currency).toBeDefined();
    expect(schemas.CurrencyResponse).toBeDefined();
    expect(schemas.AnchorProvider).toBeDefined();
    expect(schemas.AnchorListResponse).toBeDefined();
    expect(schemas.AnchorDetailResponse).toBeDefined();
    expect(schemas.ErrorResponse).toBeDefined();
    expect(schemas.HealthResponse).toBeDefined();
  });

  it('should define security schemes', () => {
    const openApiPath = join(__dirname, '../../openapi.yaml');
    const fileContents = readFileSync(openApiPath, 'utf8');
    const spec = yaml.load(fileContents) as any;

    expect(spec.components.securitySchemes).toBeDefined();
    expect(spec.components.securitySchemes.ApiKeyAuth).toBeDefined();
    expect(spec.components.securitySchemes.ApiKeyAuth.type).toBe('apiKey');
    expect(spec.components.securitySchemes.ApiKeyAuth.name).toBe('x-api-key');
  });

  it('should have proper server configuration', () => {
    const openApiPath = join(__dirname, '../../openapi.yaml');
    const fileContents = readFileSync(openApiPath, 'utf8');
    const spec = yaml.load(fileContents) as any;

    expect(spec.servers).toBeDefined();
    expect(spec.servers.length).toBeGreaterThan(0);
    expect(spec.servers[0].url).toBeDefined();
  });
});
