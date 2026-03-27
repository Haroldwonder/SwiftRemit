#!/usr/bin/env node
// Validates that all env vars consumed in source code are present in the corresponding .env.example

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Map of [sourceGlob, envExamplePath, extractPattern]
const CHECKS = [
  {
    name: 'root (examples/)',
    sources: ['examples/**/*.js'],
    envExample: '.env.example',
    pattern: /process\.env\.([A-Z][A-Z0-9_]+)/g,
    // Exclude dotenv internals and dynamic vars
    ignore: new Set([
      'DOTENV_CONFIG_DEBUG', 'DOTENV_CONFIG_DOTENV_KEY', 'DOTENV_CONFIG_ENCODING',
      'DOTENV_CONFIG_OVERRIDE', 'DOTENV_CONFIG_PATH', 'DOTENV_CONFIG_QUIET',
      'DOTENV_KEY', 'NODE_DEBUG', 'NODE_ENV', 'DEBUG', 'LOG_LEVEL',
      'REQUEST_ID', 'NEW_CONTRACT_ID', 'OLD_CONTRACT_ID', 'CONTRACT_ID',
    ]),
  },
  {
    name: 'api/',
    sources: ['api/src/**/*.ts'],
    envExample: 'api/.env.example',
    pattern: /process\.env\.([A-Z][A-Z0-9_]+)/g,
    ignore: new Set(['NODE_ENV']),
  },
  {
    name: 'backend/',
    sources: ['backend/src/**/*.ts'],
    envExample: 'backend/.env.example',
    pattern: /process\.env\.([A-Z][A-Z0-9_]+)/g,
    ignore: new Set(['NODE_ENV']),
  },
  {
    name: 'frontend/',
    sources: ['frontend/src/**/*.{ts,tsx,js,jsx}'],
    envExample: 'frontend/.env.example',
    pattern: /import\.meta\.env\.(VITE_[A-Z0-9_]+)/g,
    ignore: new Set(),
  },
];

function glob(pattern) {
  const { execSync } = require('child_process');
  try {
    return execSync(`find ${ROOT} -type f -path "${ROOT}/${pattern.replace(/\*\*/g, '*').replace(/\*/g, '*')}" 2>/dev/null`, { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function findFiles(pattern) {
  const { execSync } = require('child_process');
  const cmd = `find ${ROOT}/${pattern.split('/')[0]} -type f -name "*.${pattern.split('.').pop()}" 2>/dev/null`;
  // Use a proper glob approach
  try {
    const base = pattern.split('/**')[0];
    const ext = pattern.match(/\{([^}]+)\}/) 
      ? pattern.match(/\{([^}]+)\}/)[1].split(',').map(e => `-name "*.${e}"`).join(' -o ')
      : `-name "*.${pattern.split('.').pop()}"`;
    const result = execSync(
      `find ${ROOT}/${base} -type f \\( ${ext} \\) 2>/dev/null`,
      { encoding: 'utf8' }
    );
    return result.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function extractFromExample(envExamplePath) {
  const fullPath = path.join(ROOT, envExamplePath);
  if (!fs.existsSync(fullPath)) return new Set();
  return new Set(
    fs.readFileSync(fullPath, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.split('=')[0].trim())
  );
}

function extractFromSources(sources, pattern) {
  const vars = new Set();
  for (const src of sources) {
    const files = findFiles(src);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      let match;
      const re = new RegExp(pattern.source, pattern.flags);
      while ((match = re.exec(content)) !== null) {
        vars.add(match[1]);
      }
    }
  }
  return vars;
}

let failed = false;

for (const check of CHECKS) {
  const defined = extractFromExample(check.envExample);
  const used = extractFromSources(check.sources, check.pattern);

  const missing = [...used].filter(v => !check.ignore.has(v) && !defined.has(v));

  if (missing.length > 0) {
    console.error(`\n❌ [${check.name}] Missing in ${check.envExample}:`);
    missing.forEach(v => console.error(`   - ${v}`));
    failed = true;
  } else {
    console.log(`✅ [${check.name}] ${check.envExample} is in sync`);
  }
}

if (failed) {
  console.error('\nValidation failed. Add missing variables to the corresponding .env.example files.');
  process.exit(1);
} else {
  console.log('\nAll .env.example files are in sync with source code.');
}
