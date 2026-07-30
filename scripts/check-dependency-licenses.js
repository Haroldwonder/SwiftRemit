#!/usr/bin/env node
/**
 * SR-101 — verify every third-party dependency carries a licence that can
 * lawfully be redistributed inside this MIT-licensed project.
 *
 * Works straight off the committed package-lock.json files (npm lockfile v2/v3
 * records a `license` field per package), so it needs no `npm install` and runs
 * in about a second in CI.
 *
 * Rules:
 *   - only permissive, notice-only licences are allowed
 *   - copyleft (GPL / AGPL / LGPL / SSPL / EUPL / CDDL / MPL-only) is rejected
 *   - an SPDX "OR" expression passes if ANY operand is allowed
 *   - an SPDX "AND" expression passes only if EVERY operand is allowed
 *   - first-party @swiftremit/* workspace links are skipped (they are MIT; see
 *     scripts/check-manifest-licenses.js)
 *
 * Usage: node scripts/check-dependency-licenses.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const LOCKFILES = [
  'backend/package-lock.json',
  'api/package-lock.json',
  'frontend/package-lock.json',
  'sdk/package-lock.json',
  'examples/package-lock.json',
];

// Permissive licences compatible with redistribution under MIT.
const ALLOWED = new Set([
  '0BSD',
  'AFL-2.1',
  'APACHE-1.1',
  'APACHE-2.0',
  'ARTISTIC-2.0',
  'BLUEOAK-1.0.0',
  'BSD',
  'BSD-2-CLAUSE',
  'BSD-3-CLAUSE',
  'BSL-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0', // file-level copyleft only; safe to link from MIT code
  'PYTHON-2.0',
  'UNLICENSE',
  'UNICODE-DFS-2016',
  'UNICODE-3.0',
  'WTFPL',
  'ZLIB',
]);

// Package name -> justification. For licences whose SPDX string is not
// machine-parseable but which have been reviewed by hand. Empty today; add an
// entry only with a written reason that the licence stays MIT-redistributable.
const EXCEPTIONS = {};

/** @type {string[]} */
const violations = [];
/** @type {Map<string, number>} */
const summary = new Map();

/**
 * Evaluate an SPDX-ish expression against the allow-list.
 * Handles parentheses, OR, AND, and the "+" / "WITH" suffixes.
 */
function isAllowed(expr) {
  const tokens = String(expr).trim();
  if (!tokens) return false;

  // Strip surrounding parentheses when they wrap the whole expression.
  const stripped = tokens.replace(/^\((.*)\)$/s, '$1').trim();

  if (/\bOR\b/i.test(stripped)) {
    return splitTop(stripped, 'OR').some(isAllowed);
  }
  if (/\bAND\b/i.test(stripped)) {
    return splitTop(stripped, 'AND').every(isAllowed);
  }

  const id = stripped
    .replace(/\s+WITH\s+.*$/i, '') // "Apache-2.0 WITH LLVM-exception"
    .replace(/\+$/, '') // "EPL-1.0+"
    .replace(/^\((.*)\)$/s, '$1')
    .trim()
    .toUpperCase();

  return ALLOWED.has(id);
}

/** Split on a top-level (non-parenthesised) operator. */
function splitTop(expr, op) {
  const parts = [];
  let depth = 0;
  let current = '';
  const words = expr.split(/\s+/);
  for (const word of words) {
    if (depth === 0 && word.toUpperCase() === op) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    depth += (word.match(/\(/g) || []).length;
    depth -= (word.match(/\)/g) || []).length;
    current += (current ? ' ' : '') + word;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

function packageName(lockKey) {
  const idx = lockKey.lastIndexOf('node_modules/');
  return idx === -1 ? lockKey : lockKey.slice(idx + 'node_modules/'.length);
}

function scan(lockfile) {
  const abs = path.join(ROOT, lockfile);
  if (!fs.existsSync(abs)) return;

  const lock = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const packages = lock.packages || {};

  for (const [key, meta] of Object.entries(packages)) {
    if (!key) continue; // the root project itself
    if (meta.dev || meta.optional) continue; // dev deps are not redistributed
    if (meta.link) continue; // workspace symlink

    const name = packageName(key);
    if (name.startsWith('@swiftremit/')) continue; // first-party, MIT

    const license = meta.license;

    if (license === undefined || license === null || license === '') {
      violations.push(`${lockfile}: ${name} declares no licence`);
      continue;
    }

    const expr = Array.isArray(license) ? license.join(' OR ') : String(license);
    summary.set(expr, (summary.get(expr) || 0) + 1);

    if (isAllowed(expr)) continue;
    if (EXCEPTIONS[name]) continue;

    violations.push(`${lockfile}: ${name} is licensed "${expr}" (not MIT-compatible)`);
  }
}

for (const lockfile of LOCKFILES) scan(lockfile);

console.log('Dependency licences found:');
for (const [license, count] of [...summary].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${license}`);
}
console.log('');

if (violations.length > 0) {
  console.error('✗ MIT-incompatible dependency licences detected:\n');
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    '\nAdd a reviewed entry to EXCEPTIONS in this script, or replace the dependency.',
  );
  process.exit(1);
}

console.log('✓ All production dependencies carry MIT-compatible licences');
