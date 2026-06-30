import { writeFileSync } from 'fs';
import { dump } from 'js-yaml';
import { generateOpenAPISpec } from './src/openapi-generator';

function main(): void {
  const document = generateOpenAPISpec();
  const yaml = dump(document, { indent: 2, lineWidth: -1 });
  writeFileSync('openapi.yaml', yaml, 'utf8');
  process.stdout.write('✅ API OpenAPI spec generated successfully!\n');
}

main();
