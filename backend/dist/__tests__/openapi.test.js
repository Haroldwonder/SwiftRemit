"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path_1 = require("path");
const js_yaml_1 = __importDefault(require("js-yaml"));
(0, vitest_1.describe)('OpenAPI Specification', () => {
    (0, vitest_1.it)('should have a valid openapi.yaml file', () => {
        const openApiPath = (0, path_1.join)(__dirname, '../../openapi.yaml');
        const fileContents = (0, fs_1.readFileSync)(openApiPath, 'utf8');
        const spec = js_yaml_1.default.load(fileContents);
        (0, vitest_1.expect)(spec).toBeDefined();
        (0, vitest_1.expect)(spec.openapi).toBe('3.0.0');
        (0, vitest_1.expect)(spec.info).toBeDefined();
        (0, vitest_1.expect)(spec.info.title).toBe('SwiftRemit Backend Service');
        (0, vitest_1.expect)(spec.paths).toBeDefined();
    });
    (0, vitest_1.it)('should document all asset verification endpoints', () => {
        const openApiPath = (0, path_1.join)(__dirname, '../../openapi.yaml');
        const fileContents = (0, fs_1.readFileSync)(openApiPath, 'utf8');
        const spec = js_yaml_1.default.load(fileContents);
        (0, vitest_1.expect)(spec.paths['/api/verification/{assetCode}/{issuer}']).toBeDefined();
        (0, vitest_1.expect)(spec.paths['/api/verification/verify']).toBeDefined();
        (0, vitest_1.expect)(spec.paths['/api/verification/report']).toBeDefined();
        (0, vitest_1.expect)(spec.paths['/api/verification/verified']).toBeDefined();
        (0, vitest_1.expect)(spec.paths['/api/verification/batch']).toBeDefined();
    });
    (0, vitest_1.it)('should document KYC endpoints', () => {
        const openApiPath = (0, path_1.join)(__dirname, '../../openapi.yaml');
        const fileContents = (0, fs_1.readFileSync)(openApiPath, 'utf8');
        const spec = js_yaml_1.default.load(fileContents);
        (0, vitest_1.expect)(spec.paths['/api/kyc/status']).toBeDefined();
        (0, vitest_1.expect)(spec.paths['/api/kyc/status'].get).toBeDefined();
    });
    (0, vitest_1.it)('should document transfer endpoint', () => {
        const openApiPath = (0, path_1.join)(__dirname, '../../openapi.yaml');
        const fileContents = (0, fs_1.readFileSync)(openApiPath, 'utf8');
        const spec = js_yaml_1.default.load(fileContents);
        (0, vitest_1.expect)(spec.paths['/api/transfer']).toBeDefined();
        (0, vitest_1.expect)(spec.paths['/api/transfer'].post).toBeDefined();
    });
    (0, vitest_1.it)('should document FX rate endpoints', () => {
        const openApiPath = (0, path_1.join)(__dirname, '../../openapi.yaml');
        const fileContents = (0, fs_1.readFileSync)(openApiPath, 'utf8');
        const spec = js_yaml_1.default.load(fileContents);
        (0, vitest_1.expect)(spec.paths['/api/fx-rate']).toBeDefined();
        (0, vitest_1.expect)(spec.paths['/api/fx-rate'].post).toBeDefined();
        (0, vitest_1.expect)(spec.paths['/api/fx-rate/{transactionId}']).toBeDefined();
        (0, vitest_1.expect)(spec.paths['/api/fx-rate/{transactionId}'].get).toBeDefined();
    });
    (0, vitest_1.it)('should document webhook endpoint', () => {
        const openApiPath = (0, path_1.join)(__dirname, '../../openapi.yaml');
        const fileContents = (0, fs_1.readFileSync)(openApiPath, 'utf8');
        const spec = js_yaml_1.default.load(fileContents);
        (0, vitest_1.expect)(spec.paths['/api/webhook']).toBeDefined();
        (0, vitest_1.expect)(spec.paths['/api/webhook'].post).toBeDefined();
    });
    (0, vitest_1.it)('should document health check endpoint', () => {
        const openApiPath = (0, path_1.join)(__dirname, '../../openapi.yaml');
        const fileContents = (0, fs_1.readFileSync)(openApiPath, 'utf8');
        const spec = js_yaml_1.default.load(fileContents);
        (0, vitest_1.expect)(spec.paths['/health']).toBeDefined();
        (0, vitest_1.expect)(spec.paths['/health'].get).toBeDefined();
    });
    (0, vitest_1.it)('should define all required schemas', () => {
        const openApiPath = (0, path_1.join)(__dirname, '../../openapi.yaml');
        const fileContents = (0, fs_1.readFileSync)(openApiPath, 'utf8');
        const spec = js_yaml_1.default.load(fileContents);
        const schemas = spec.components.schemas;
        (0, vitest_1.expect)(schemas.AssetVerification).toBeDefined();
        (0, vitest_1.expect)(schemas.UserKycStatus).toBeDefined();
        (0, vitest_1.expect)(schemas.FxRateRecord).toBeDefined();
        (0, vitest_1.expect)(schemas.ErrorResponse).toBeDefined();
    });
    (0, vitest_1.it)('should define security schemes', () => {
        const openApiPath = (0, path_1.join)(__dirname, '../../openapi.yaml');
        const fileContents = (0, fs_1.readFileSync)(openApiPath, 'utf8');
        const spec = js_yaml_1.default.load(fileContents);
        (0, vitest_1.expect)(spec.components.securitySchemes).toBeDefined();
        (0, vitest_1.expect)(spec.components.securitySchemes.UserAuth).toBeDefined();
        (0, vitest_1.expect)(spec.components.securitySchemes.WebhookSignature).toBeDefined();
    });
    (0, vitest_1.it)('should have proper server configuration', () => {
        const openApiPath = (0, path_1.join)(__dirname, '../../openapi.yaml');
        const fileContents = (0, fs_1.readFileSync)(openApiPath, 'utf8');
        const spec = js_yaml_1.default.load(fileContents);
        (0, vitest_1.expect)(spec.servers).toBeDefined();
        (0, vitest_1.expect)(spec.servers.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(spec.servers[0].url).toBeDefined();
    });
});
