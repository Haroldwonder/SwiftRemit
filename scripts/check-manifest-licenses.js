#!/usr/bin/env node
/**
 * SR-101 — assert every package manifest in the repo declares the MIT licence.
 *
 * Checks:
 *   - a LICENSE file exists at the repository root and contains the MIT text
 *   - every package.json (outside node_modules) has "license": "MIT"
 *   - every Cargo.toml with a [package] section has license = "MIT"
 *
 * Exits non-zero with a list of offending files.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set([
  'node_modules',
  'target',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
]);

/** @type {string[]} */
const errors = [];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.name === 'package.json' || entry.name === 'Cargo.toml') {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function checkLicenseFile() {
  const licensePath = path.join(ROOT, 'LICENSE');
  if (!fs.existsSync(licensePath)) {
    errors.push('LICENSE: missing at the repository root');
    return;
  }
  const text = fs.readFileSync(licensePath, 'utf8');
  if (!/MIT License/i.test(text) || !/Permission is hereby granted, free of charge/i.test(text)) {
    errors.push('LICENSE: does not contain the MIT licence text');
  }
  if (!/Copyright \(c\) \d{4}/.test(text)) {
    errors.push('LICENSE: missing a "Copyright (c) <year> <holder>" line');
  }
}

function checkPackageJson(file) {
  const rel = path.relative(ROOT, file);
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    errors.push(`${rel}: not valid JSON (${err.message})`);
    return;
  }
  // A lockfile-only stub package.json has no name; skip it.
  if (!json.name) return;
  if (json.license !== 'MIT') {
    errors.push(`${rel}: license is ${JSON.stringify(json.license ?? null)}, expected "MIT"`);
  }
}

function checkCargoToml(file) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, 'utf8');
  // Only manifests that declare a [package] need a licence; pure workspace roots do not.
  if (!/^\s*\[package\]\s*$/m.test(text)) return;
  if (!/^\s*license\s*=\s*"MIT"\s*$/m.test(text)) {
    errors.push(`${rel}: [package] does not declare license = "MIT"`);
  }
}

checkLicenseFile();

for (const file of walk(ROOT, [])) {
  if (path.basename(file) === 'package.json') checkPackageJson(file);
  else checkCargoToml(file);
}

if (errors.length > 0) {
  console.error('✗ Licence declaration check failed:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\nSee LICENSE and SR-101. Every package manifest must declare MIT.');
  process.exit(1);
}

console.log('✓ LICENSE present and every package manifest declares MIT');
