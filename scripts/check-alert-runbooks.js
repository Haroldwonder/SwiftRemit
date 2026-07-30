#!/usr/bin/env node
/**
 * SR-104 — every alert must point at a runbook procedure that actually exists.
 *
 * Parses the Prometheus rule files, pulls the `runbook_url` annotation out of
 * each alert, and resolves its `#fragment` against the headings in RUNBOOK.md
 * (using GitHub's anchor slug rules). Fails on:
 *
 *   - an alert with no runbook_url
 *   - an alert with no severity or team label
 *   - a runbook_url pointing at a section that does not exist
 *
 * Dependency-free: the rule files use a small enough subset of YAML that a
 * targeted line scanner is more robust here than pulling in a parser.
 *
 * Usage: node scripts/check-alert-runbooks.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUNBOOK = path.join(ROOT, 'RUNBOOK.md');

const RULE_FILES = [
  'monitoring/alerts.yml',
  'monitoring/slo.yml',
];

const VALID_SEVERITIES = new Set(['critical', 'warning', 'info']);

/** GitHub's heading -> anchor slug: lowercase, strip punctuation, spaces to dashes. */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    .replace(/ +/g, '-');
}

function runbookAnchors() {
  const anchors = new Set();
  const text = fs.readFileSync(RUNBOOK, 'utf8');
  for (const line of text.split('\n')) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (match) anchors.add(slugify(match[1]));
  }
  return anchors;
}

/**
 * Extract alerts from a Prometheus rule file. Returns
 * [{ name, file, line, severity, team, runbookUrl }].
 */
function parseAlerts(file) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  const alerts = [];
  let current = null;
  let inLabels = false;
  let inAnnotations = false;

  const flush = () => {
    if (current) alerts.push(current);
    current = null;
    inLabels = false;
    inAnnotations = false;
  };

  lines.forEach((raw, index) => {
    const alertMatch = /^\s*-\s*alert:\s*(\S+)\s*$/.exec(raw);
    if (alertMatch) {
      flush();
      current = {
        name: alertMatch[1],
        file,
        line: index + 1,
        severity: null,
        team: null,
        runbookUrl: null,
      };
      return;
    }

    // A new record at the rules level ends the current alert.
    if (current && /^\s*-\s*record:/.test(raw)) {
      flush();
      return;
    }

    if (!current) return;

    if (/^\s*labels:\s*$/.test(raw)) {
      inLabels = true;
      inAnnotations = false;
      return;
    }
    if (/^\s*annotations:\s*$/.test(raw)) {
      inAnnotations = true;
      inLabels = false;
      return;
    }

    if (inLabels) {
      const severity = /^\s*severity:\s*(\S+)\s*$/.exec(raw);
      if (severity) current.severity = severity[1].replace(/["']/g, '');
      const team = /^\s*team:\s*(\S+)\s*$/.exec(raw);
      if (team) current.team = team[1].replace(/["']/g, '');
    }

    if (inAnnotations) {
      const runbook = /^\s*runbook_url:\s*(.+?)\s*$/.exec(raw);
      if (runbook) current.runbookUrl = runbook[1].replace(/^["']|["']$/g, '');
    }
  });

  flush();
  return alerts;
}

const anchors = runbookAnchors();
const errors = [];
const alerts = [];

for (const file of RULE_FILES) {
  if (!fs.existsSync(path.join(ROOT, file))) {
    errors.push(`${file}: rule file is missing`);
    continue;
  }
  alerts.push(...parseAlerts(file));
}

if (alerts.length === 0) {
  errors.push('no alert rules found — the parser or the rule files are wrong');
}

const seen = new Map();

for (const alert of alerts) {
  const where = `${alert.file}:${alert.line} ${alert.name}`;

  if (seen.has(alert.name)) {
    errors.push(`${where}: duplicate alert name (also at ${seen.get(alert.name)})`);
  } else {
    seen.set(alert.name, where);
  }

  if (!alert.severity) {
    errors.push(`${where}: no severity label`);
  } else if (!VALID_SEVERITIES.has(alert.severity)) {
    errors.push(
      `${where}: severity "${alert.severity}" is not one of ${[...VALID_SEVERITIES].join(', ')}`,
    );
  }

  if (!alert.team) {
    errors.push(`${where}: no team label — Alertmanager cannot route it`);
  }

  if (!alert.runbookUrl) {
    errors.push(`${where}: no runbook_url annotation`);
    continue;
  }

  const fragment = alert.runbookUrl.split('#')[1];
  if (!fragment) {
    errors.push(`${where}: runbook_url "${alert.runbookUrl}" has no #section fragment`);
    continue;
  }

  if (!anchors.has(fragment)) {
    errors.push(`${where}: RUNBOOK.md has no section "#${fragment}"`);
  }
}

if (errors.length > 0) {
  console.error(`✗ Alert / runbook check failed (${errors.length} problem(s)):\n`);
  for (const error of errors) console.error(`  - ${error}`);
  console.error('\nEvery alert needs a severity, a team, and a runbook_url whose');
  console.error('#section exists in RUNBOOK.md. See SR-104.');
  process.exit(1);
}

console.log(
  `✓ ${alerts.length} alerts across ${RULE_FILES.length} rule files each have a severity, ` +
    'a team, and a runbook section that exists',
);
