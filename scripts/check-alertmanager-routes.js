#!/usr/bin/env node
/**
 * SR-214 — every alert must be routable.
 *
 * Cross-checks the `team:` labels used by the Prometheus rule files against the
 * routing tree in monitoring/alertmanager.yml. Fails on:
 *
 *   - a `team:` value used by a rule that no route in alertmanager.yml matches
 *   - a route (or the top-level route) that names a receiver which is not defined
 *   - a `team:` value that is not one of the documented set (payments | platform
 *     | backend) — keeps alerts.yml's header comment honest
 *
 * Dependency-free on purpose: the two rule files use a small enough YAML subset
 * that a line scanner is more robust than pulling in a parser, and the parts of
 * alertmanager.yml we care about (route matchers, receiver names) are matched
 * with targeted regexes.
 *
 * Usage: node scripts/check-alertmanager-routes.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ALERTMANAGER = path.join(ROOT, 'monitoring/alertmanager.yml');
const RULE_FILES = ['monitoring/alerts.yml', 'monitoring/slo.yml'];
const DOCUMENTED_TEAMS = new Set(['payments', 'platform', 'backend']);

const errors = [];

/** Collect every distinct `team:` label value used by an alert rule. */
function teamsUsedByRules() {
  const teams = new Map(); // team -> "file:line" of first use
  for (const rel of RULE_FILES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
      errors.push(`${rel}: rule file is missing`);
      continue;
    }
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const m = /^\s*team:\s*["']?([\w-]+)["']?\s*$/.exec(line);
        if (m && !teams.has(m[1])) teams.set(m[1], `${rel}:${i + 1}`);
      });
  }
  return teams;
}

/** Parse alertmanager.yml for defined receivers and the team values its routes match. */
function alertmanagerRouting() {
  if (!fs.existsSync(ALERTMANAGER)) {
    errors.push('monitoring/alertmanager.yml is missing');
    return { receivers: new Set(), routedTeams: new Set(), referencedReceivers: [] };
  }
  const text = fs.readFileSync(ALERTMANAGER, 'utf8');
  const lines = text.split('\n');

  const receivers = new Set();
  let inReceivers = false;
  for (const line of lines) {
    if (/^receivers:\s*$/.test(line)) { inReceivers = true; continue; }
    // A new top-level key ends the receivers block.
    if (inReceivers && /^\S/.test(line)) inReceivers = false;
    if (inReceivers) {
      const m = /^\s*-?\s*name:\s*["']?([\w-]+)["']?\s*$/.exec(line);
      if (m) receivers.add(m[1]);
    }
  }

  // Every `receiver:` reference anywhere in the file must resolve.
  const referencedReceivers = [];
  for (const line of lines) {
    const m = /^\s*receiver:\s*["']?([\w-]+)["']?\s*$/.exec(line);
    if (m) referencedReceivers.push(m[1]);
  }

  // Team values named by route matchers: `team = "x"`, `team="x"`, `team =~ "x"`.
  const routedTeams = new Set();
  for (const line of lines) {
    const m = /team\s*=~?\s*["']([\w-]+)["']/.exec(line);
    if (m) routedTeams.add(m[1]);
  }

  return { receivers, routedTeams, referencedReceivers };
}

const teams = teamsUsedByRules();
const { receivers, routedTeams, referencedReceivers } = alertmanagerRouting();

if (teams.size === 0) {
  errors.push('no `team:` labels found in the rule files — the parser or the rules are wrong');
}

for (const [team, where] of teams) {
  if (!DOCUMENTED_TEAMS.has(team)) {
    errors.push(
      `${where}: team "${team}" is not one of the documented teams ` +
        `(${[...DOCUMENTED_TEAMS].join(', ')}) — update alerts.yml's header and this script`,
    );
  }
  if (!routedTeams.has(team)) {
    errors.push(
      `${where}: team "${team}" has no matching route in monitoring/alertmanager.yml — ` +
        'alerts for it would fall through to the default receiver only',
    );
  }
}

for (const receiver of new Set(referencedReceivers)) {
  if (!receivers.has(receiver)) {
    errors.push(`monitoring/alertmanager.yml: route references undefined receiver "${receiver}"`);
  }
}

// A team route should also name a real receiver (already covered above), and we
// expect at least the default receiver plus one per documented team.
for (const team of DOCUMENTED_TEAMS) {
  if (routedTeams.has(team) && !receivers.has(`team-${team}`)) {
    errors.push(
      `monitoring/alertmanager.yml: routes team "${team}" but has no "team-${team}" receiver`,
    );
  }
}

if (errors.length > 0) {
  console.error(`✗ Alertmanager routing check failed (${errors.length} problem(s)):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\nEvery `team:` label used by a rule must map to a route in');
  console.error('monitoring/alertmanager.yml, and every route must name a real receiver. See SR-214.');
  process.exit(1);
}

console.log(
  `✓ ${teams.size} team label(s) (${[...teams.keys()].sort().join(', ')}) each route to a ` +
    `defined receiver; ${receivers.size} receivers declared`,
);
