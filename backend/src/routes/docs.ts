import { Router, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

const router = Router();

// Load OpenAPI spec
const openApiPath = join(__dirname, '../../openapi.yaml');
let openApiSpec: any;

try {
  const fileContents = readFileSync(openApiPath, 'utf8');
  openApiSpec = yaml.load(fileContents);
} catch (error) {
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
router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(openApiSpec, {
  customSiteTitle: 'SwiftRemit Backend API Documentation',
  customCss: '.swagger-ui .topbar { display: none }',
}));

// Serve raw OpenAPI spec
router.get('/openapi.json', (req: Request, res: Response) => {
  res.json(openApiSpec);
});

router.get('/openapi.yaml', (req: Request, res: Response) => {
  res.type('text/yaml');
  res.send(yaml.dump(openApiSpec));
});

export default router;
