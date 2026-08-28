#!/usr/bin/env node
/**
 * Enforces the "Automated Expiry Alerts" policy from
 * docs/VULNERABILITY_EXCEPTIONS.md: "Exceptions reaching their expiration
 * date automatically fail CI builds until renewed or patched."
 *
 * Before this script existed, nothing in the repo actually implemented that
 * policy — .trivyignore was never referenced by container-security.yml, and
 * nothing parsed the "(Expires: YYYY-MM-DD)" comment convention that
 * VULNERABILITY_EXCEPTIONS.md itself requires. An exception recorded with an
 * expiry date would silently remain in effect forever.
 *
 * Scans .trivyignore and deny.toml for the "Expires: YYYY-MM-DD" comment
 * convention and fails (exit 1) once any entry's date has passed. Run ahead
 * of the trivy scan / cargo-deny steps in CI so an expired exception blocks
 * the build rather than silently continuing to suppress a finding.
 *
 * Usage: node scripts/check-exception-expiry.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const TARGETS = [
  // Trivy exceptions are listed as bare CVE ids preceded by a justification
  // comment, per the format documented in VULNERABILITY_EXCEPTIONS.md:
  //   # CVE-2026-1111: ... (Approved by @security, Expires: 2026-08-30)
  //   CVE-2026-1111
  { file: '.trivyignore', idPattern: /\b(CVE-\d{4}-\d+)\b/ },
  // Rust advisory exceptions live in deny.toml's [advisories] ignore list:
  //   # RUSTSEC-2024-0001: ... (Expires: 2026-08-30)
  //   "RUSTSEC-2024-0001",
  { file: 'deny.toml', idPattern: /(RUSTSEC-\d{4}-\d+)/ },
];

const EXPIRES_PATTERN = /Expires:\s*(\d{4}-\d{2}-\d{2})/i;

function main() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const expired = [];
  const malformed = [];
  let entriesChecked = 0;

  for (const target of TARGETS) {
    const filePath = path.join(ROOT, target.file);
    if (!fs.existsSync(filePath)) continue;

    const lines = fs.readFileSync(filePath, 'utf8').split('\n');

    lines.forEach((line, index) => {
      const expiresMatch = line.match(EXPIRES_PATTERN);
      if (!expiresMatch) return;

      entriesChecked += 1;
      const expiresStr = expiresMatch[1];
      const expiresDate = new Date(`${expiresStr}T00:00:00Z`);

      if (Number.isNaN(expiresDate.getTime())) {
        malformed.push(
          `${target.file}:${index + 1}: unparsable Expires date "${expiresStr}" (expected YYYY-MM-DD)`,
        );
        return;
      }

      const idMatch = line.match(target.idPattern);
      const id = idMatch ? idMatch[1] : `<unidentified exception at line ${index + 1}>`;

      if (expiresDate.getTime() < today.getTime()) {
        const daysOverdue = Math.round((today.getTime() - expiresDate.getTime()) / 86400000);
        expired.push({ file: target.file, line: index + 1, id, expires: expiresStr, daysOverdue });
      }
    });
  }

  if (malformed.length > 0) {
    console.error('Malformed "Expires:" date(s) found:');
    for (const entry of malformed) console.error(`  - ${entry}`);
    console.error('');
  }

  if (expired.length > 0) {
    console.error('Expired vulnerability exceptions found (see docs/VULNERABILITY_EXCEPTIONS.md):');
    for (const entry of expired) {
      console.error(
        `  - ${entry.file}:${entry.line}: ${entry.id} expired on ${entry.expires} (${entry.daysOverdue} day(s) overdue)`,
      );
    }
    console.error('\nRenew the exception with fresh approval and an updated Expires date, or remove it and patch the underlying finding.');
  }

  if (expired.length > 0 || malformed.length > 0) {
    process.exit(1);
  }

  console.log(
    entriesChecked > 0
      ? `OK: ${entriesChecked} vulnerability exception(s) checked, none expired.`
      : 'OK: no vulnerability exceptions recorded in .trivyignore or deny.toml.',
  );
}

main();
