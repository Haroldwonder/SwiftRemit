#!/usr/bin/env node
// Fails the build when a public contract function has no SDK binding and no
// explicit exclusion. Keeps sdk/src/client.ts honest against src/lib.rs as
// the contract surface grows (SR-083).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const libRs = readFileSync(path.join(repoRoot, "src", "lib.rs"), "utf8");
const clientTs = readFileSync(path.join(repoRoot, "sdk", "src", "client.ts"), "utf8");
const exclusions = JSON.parse(
  readFileSync(path.join(__dirname, "coverage-exclusions.json"), "utf8")
);

// Restrict extraction to the #[contractimpl] block so we only count the
// contract's actual public entry points, not unrelated `pub fn` helpers.
const implStart = libRs.indexOf("impl SwiftRemitContract");
if (implStart === -1) {
  console.error("check-contract-coverage: could not locate `impl SwiftRemitContract` in src/lib.rs");
  process.exit(1);
}
const implBody = libRs.slice(implStart);

const contractFns = new Set(
  [...implBody.matchAll(/^ {4}pub fn (\w+)\(/gm)].map((m) => m[1])
);

// The SDK calls contract methods via string literals: this.prepareTransaction(
// source, "method_name", ...) / this.simulateCall(source, "method_name", ...).
const boundFns = new Set(
  [...clientTs.matchAll(/\b(?:prepareTransaction|simulateCall)\(\s*[^,]+,\s*"(\w+)"/g)].map(
    (m) => m[1]
  )
);

const missing = [...contractFns]
  .filter((fn) => !boundFns.has(fn) && !exclusions[fn])
  .sort();

if (missing.length > 0) {
  console.error(
    `check-contract-coverage: ${missing.length} contract function(s) have no SDK binding and no exclusion entry:\n`
  );
  for (const fn of missing) console.error(`  - ${fn}`);
  console.error(
    "\nAdd a binding in sdk/src/client.ts, or a justified entry in sdk/scripts/coverage-exclusions.json."
  );
  process.exit(1);
}

console.log(
  `check-contract-coverage: OK — ${contractFns.size} contract function(s), ${boundFns.size} bound, ${
    Object.keys(exclusions).length
  } excluded.`
);
