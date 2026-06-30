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
    expect(spec.info.title).toBe('SwiftRemit Backend Service');
    expect(spec.paths).toBeDefined();
  });

  it('should document all asset verification endpoints', () => {
    const openApiPath = join(__dirname, '../../openapi.yaml');
    const fileContents = readFileSync(openApiPath, 'utf8');
    const spec = yaml.load(fileContents) as any;

    expect(spec.paths['/api/verification/{assetCode}/{issuer}']).toBeDefined();
    expect(spec.paths['/api/verification/verify']).toBeDefined();
    expect(spec.paths['/api/verification/report']).toBeDefined();
    expect(spec.paths['/api/verification/verified']).toBeDefined();
    expect(spec.paths['/api/verification/batch']).toBeDefined();
  });

  it('should document KYC endpoints', () => {
    const openApiPath = join(__dirname, '../../openapi.yaml');
    const fileContents = readFileSync(openApiPath, 'utf8');
    const spec = yaml.load(fileContents) as any;

    expect(spec.paths['/api/kyc/status']).toBeDefined();
    expect(spec.paths['/api/kyc/status'].get).toBeDefined();
  });

  it('should document transfer endpoint', () => {
    const openApiPath = join(__dirname, '../../openapi.yaml');
    const fileContents = readFileSync(openApiPath, 'utf8');
    const spec = yaml.load(fileContents) as any;

    expect(spec.paths['/api/transfer']).toBeDefined();
    expect(spec.paths['/api/transfer'].post).toBeDefined();
  });

  it('should document FX rate endpoints', () => {
    const openApiPath = join(__dirname, '../../openapi.yaml');
    const fileContents = readFileSync(openApiPath, 'utf8');
    const spec = yaml.load(fileContents) as any;

    expect(spec.paths['/api/fx-rate']).toBeDefined();
    expect(spec.paths['/api/fx-rate'].post).toBeDefined();
    expect(spec.paths['/api/fx-rate/{transactionId}']).toBeDefined();
    expect(spec.paths['/api/fx-rate/{transactionId}'].get).toBeDefined();
  });

  it('should document webhook endpoint', () => {
    const openApiPath = join(__dirname, '../../openapi.yaml');
    const fileContents = readFileSync(openApiPath, 'utf8');
    const spec = yaml.load(fileContents) as any;

    expect(spec.paths['/api/webhook']).toBeDefined();
    expect(spec.paths['/api/webhook'].post).toBeDefined();
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
    expect(schemas.AssetVerification).toBeDefined();
    expect(schemas.UserKycStatus).toBeDefined();
    expect(schemas.FxRateRecord).toBeDefined();
    expect(schemas.ErrorResponse).toBeDefined();
  });

  it('should define security schemes', () => {
    const openApiPath = join(__dirname, '../../openapi.yaml');
    const fileContents = readFileSync(openApiPath, 'utf8');
    const spec = yaml.load(fileContents) as any;

    expect(spec.components.securitySchemes).toBeDefined();
    expect(spec.components.securitySchemes.UserAuth).toBeDefined();
    expect(spec.components.securitySchemes.WebhookSignature).toBeDefined();
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
