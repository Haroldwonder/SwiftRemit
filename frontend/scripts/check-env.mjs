#!/usr/bin/env node
/**
 * SR-102 — fail the frontend start/build when configuration is missing or still
 * holds a placeholder value copied out of .env.example.
 *
 * Vite has no server-side startup hook, so this runs as a `predev` / `prebuild`
 * npm script. Values are read from the process environment first (Docker Compose
 * injects them via env_file) and then from frontend/.env.
 *
 * Usage: node scripts/check-env.mjs [--production]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(HERE, '..', '.env');
const SRC_DIR = path.join(HERE, '..', 'src');

const isProduction =
  process.argv.includes('--production') || process.env.NODE_ENV === 'production';

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^\s*$/,
  /change[-_ ]?me/i,
  /^your[-_]/i,
  /^<.*>$/,
  /^(placeholder|example|dummy|todo|tbd|fixme)$/i,
  /^C?A{20,}/,
  /example\.com/i,
];

const REQUIREMENTS = [
  { name: 'VITE_NETWORK', requiredIn: 'always', hint: 'testnet | mainnet' },
  {
    name: 'VITE_HORIZON_URL',
    requiredIn: 'always',
    hint: 'https://horizon-testnet.stellar.org',
  },
  {
    name: 'VITE_SOROBAN_RPC_URL',
    requiredIn: 'always',
    hint: 'https://soroban-testnet.stellar.org',
  },
  {
    name: 'VITE_CONTRACT_ID',
    requiredIn: 'production',
    hint: 'the deployed SwiftRemit contract id (C...)',
  },
  {
    name: 'VITE_USDC_ISSUER',
    requiredIn: 'production',
    hint: 'the USDC issuer account (G...)',
  },
];

/** Minimal KEY=VALUE parser — enough for a .env template. */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = readEnvFile(ENV_FILE);
const lookup = (name) => process.env[name] ?? fileEnv[name];

const errors = [];
const warnings = [];

for (const req of REQUIREMENTS) {
  const value = lookup(req.name);
  const mustHold = req.requiredIn === 'always' || isProduction;

  let problem = null;
  if (value === undefined || value === '') {
    problem = 'is not set';
  } else if (PLACEHOLDER_PATTERNS.some((p) => p.test(value))) {
    problem = `still holds the .env.example placeholder ${JSON.stringify(value)}`;
  }

  if (!problem) continue;
  const message = `${req.name} ${problem} — expected ${req.hint}`;
  if (mustHold) errors.push(message);
  else warnings.push(message);
}

for (const warning of warnings) {
  console.warn(`[env] warning: ${warning}`);
}

if (errors.length > 0) {
  const mode = isProduction ? 'production' : 'development';
  console.error(
    `\n✗ frontend cannot start: ${errors.length} configuration problem(s) in ${mode} mode\n`,
  );
  for (const error of errors) console.error(`  - ${error}`);
  console.error(
    '\nRun `make setup` (or ./scripts/setup-env.sh) from the repository root to' +
      '\ncreate frontend/.env from frontend/.env.example, then fill in the values.' +
      '\nDo not point Docker Compose at a .env.example — see SR-102.\n',
  );
  process.exit(1);
}

// SR-179: Check for apiUrl prop defaults that don't reference VITE_API_URL
if (fs.existsSync(SRC_DIR)) {
  const apiUrlViolations = [];
  
  function checkDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        checkDirectory(fullPath);
      } else if (entry.name.match(/\.(tsx?|jsx?)$/)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        // Look for apiUrl prop defaults that hardcode localhost instead of using VITE_API_URL
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Match patterns like: apiUrl = 'http://localhost:3000' or apiUrl = "http://localhost:3000"
          const hardcodeMatch = line.match(/apiUrl\s*=\s*['"]http:\/\/localhost:\d+['"]/);
          if (hardcodeMatch && !line.includes('import.meta.env.VITE_API_URL')) {
            apiUrlViolations.push({
              file: path.relative(SRC_DIR, fullPath),
              line: i + 1,
              content: line.trim()
            });
          }
        }
      }
    }
  }
  
  checkDirectory(SRC_DIR);
  
  if (apiUrlViolations.length > 0) {
    console.error(
      `\n✗ SR-179: Found ${apiUrlViolations.length} component(s) with hardcoded apiUrl default instead of using VITE_API_URL\n`
    );
    for (const violation of apiUrlViolations) {
      console.error(`  - ${violation.file}:${violation.line}`);
      console.error(`    ${violation.content}\n`);
    }
    console.error(
      'Change the default to: apiUrl = import.meta.env.VITE_API_URL || \'http://localhost:3000\'\n'
    );
    process.exit(1);
  }
}

console.log('✓ frontend environment configuration looks usable');
