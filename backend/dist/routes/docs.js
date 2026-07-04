"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const fs_1 = require("fs");
const path_1 = require("path");
const js_yaml_1 = __importDefault(require("js-yaml"));
const router = (0, express_1.Router)();
// Load OpenAPI spec
const openApiPath = (0, path_1.join)(__dirname, '../../openapi.yaml');
let openApiSpec;
try {
    const fileContents = (0, fs_1.readFileSync)(openApiPath, 'utf8');
    openApiSpec = js_yaml_1.default.load(fileContents);
}
catch (error) {
    console.error('Failed to load OpenAPI spec:', error);
    openApiSpec = {
        openapi: '3.0.0',
        info: {
            title: 'SwiftRemit Backend Service',
            version: '1.0.0',
            description: 'API specification not available',
        },
        paths: {},
    };
}
// Serve Swagger UI
router.use('/', swagger_ui_express_1.default.serve);
router.get('/', swagger_ui_express_1.default.setup(openApiSpec, {
    customSiteTitle: 'SwiftRemit Backend API Documentation',
    customCss: '.swagger-ui .topbar { display: none }',
}));
// Serve raw OpenAPI spec
router.get('/openapi.json', (req, res) => {
    res.json(openApiSpec);
});
router.get('/openapi.yaml', (req, res) => {
    res.type('text/yaml');
    res.send(js_yaml_1.default.dump(openApiSpec));
});
exports.default = router;
