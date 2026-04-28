/**
 * Simple validation script to check test file structure
 * Run with: node validate-tests.js
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function validateTestFile(filePath, fileName) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    
    log(`\n📝 Validating: ${fileName}`, 'blue');
    
    const checks = [
      {
        name: 'Has describe blocks',
        test: /describe\s*\(/g,
        required: true
      },
      {
        name: 'Has it/test blocks',
        test: /(?:it|test)\s*\(/g,
        required: true
      },
      {
        name: 'Has expect assertions',
        test: /expect\s*\(/g,
        required: true
      },
      {
        name: 'Imports vitest',
        test: /from\s+['"]vitest['"]/,
        required: true
      },
      {
        name: 'Has beforeEach setup',
        test: /beforeEach\s*\(/,
        required: false
      },
      {
        name: 'Uses vi.mock',
        test: /vi\.mock\s*\(/,
        required: false
      }
    ];
    
    let passed = 0;
    let failed = 0;
    
    checks.forEach(check => {
      const matches = content.match(check.test);
      const count = matches ? matches.length : 0;
      
      if (count > 0) {
        log(`  ✅ ${check.name}: ${count} found`, 'green');
        passed++;
      } else if (check.required) {
        log(`  ❌ ${check.name}: MISSING (required)`, 'red');
        failed++;
      } else {
        log(`  ⚠️  ${check.name}: Not found (optional)`, 'yellow');
      }
    });
    
    // Count test cases
    const testCases = content.match(/(?:it|test)\s*\(/g);
    const testCount = testCases ? testCases.length : 0;
    log(`\n  📊 Total test cases: ${testCount}`, 'blue');
    
    return { passed, failed, testCount };
    
  } catch (error) {
    log(`  ❌ Error reading file: ${error.message}`, 'red');
    return { passed: 0, failed: 1, testCount: 0 };
  }
}

function main() {
  log('\n🧪 Test File Validation Report', 'blue');
  log('================================\n', 'blue');
  
  const testFiles = [
    {
      path: join(__dirname, 'src/services/__tests__/horizonService.test.ts'),
      name: 'HorizonService Tests'
    },
    {
      path: join(__dirname, 'src/components/__tests__/ProofOfPayout.test.tsx'),
      name: 'ProofOfPayout Component Tests'
    }
  ];
  
  let totalPassed = 0;
  let totalFailed = 0;
  let totalTests = 0;
  
  testFiles.forEach(file => {
    const result = validateTestFile(file.path, file.name);
    totalPassed += result.passed;
    totalFailed += result.failed;
    totalTests += result.testCount;
  });
  
  log('\n================================', 'blue');
  log('📊 Summary', 'blue');
  log('================================', 'blue');
  log(`Total test files validated: ${testFiles.length}`);
  log(`Total test cases found: ${totalTests}`, 'blue');
  log(`Validation checks passed: ${totalPassed}`, 'green');
  
  if (totalFailed > 0) {
    log(`Validation checks failed: ${totalFailed}`, 'red');
    log('\n❌ Validation FAILED', 'red');
    process.exit(1);
  } else {
    log('\n✅ All validations PASSED', 'green');
    log('\nTest files are properly structured and ready to run!', 'green');
    process.exit(0);
  }
}

main();
