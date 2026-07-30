/**
 * SR-102 — fail startup when configuration is missing or still holds a
 * placeholder value copied out of .env.example.
 *
 * Before this guard, a service whose env_file pointed at .env.example started
 * happily with `DATABASE_URL=postgresql://user:password@localhost:5432/...` and
 * only failed much later, deep inside a query, with an opaque error.
 */

export type Requirement = 'always' | 'production';

export interface EnvRequirement {
  name: string;
  requiredIn: Requirement;
  /** Shown in the failure message so the operator knows what to put there. */
  hint: string;
  /** Skip the check when this predicate returns true (e.g. managed elsewhere). */
  skipIf?: () => boolean;
}

/**
 * Values that appear verbatim in a .env.example and must never reach a running
 * service. Matched case-insensitively against the whole value or as a substring
 * where the marker is unambiguous.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^$/, // empty
  /^\s*$/, // whitespace only
  /change[-_ ]?me/i,
  /^your[-_]/i,
  /yourusername/i,
  /\byour[-_](secret|key|token|password|api[-_]?key)\b/i,
  /:\/\/user:password@/i, // postgresql://user:password@...
  /^S?X{3,}/i, // SXXX... , XXXX
  /^<.*>$/, // <CONTRACT_ID>
  /^(placeholder|example|dummy|todo|tbd|fixme)$/i,
  /^C?A{20,}/, // CAAAAAAAA...D2KM placeholder contract id
  /example\.com/i,
];

export function isPlaceholder(value: string | undefined): boolean {
  if (value === undefined) return false;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

const BACKEND_REQUIREMENTS: EnvRequirement[] = [
  {
    name: 'DATABASE_URL',
    requiredIn: 'always',
    hint: 'postgres://user:pass@host:5432/swiftremit',
  },
  {
    name: 'STELLAR_NETWORK',
    requiredIn: 'always',
    hint: 'testnet | mainnet',
  },
  {
    name: 'HORIZON_URL',
    requiredIn: 'always',
    hint: 'https://horizon-testnet.stellar.org',
  },
  {
    name: 'SOROBAN_RPC_URL',
    requiredIn: 'always',
    hint: 'https://soroban-testnet.stellar.org',
  },
  {
    name: 'NETWORK_PASSPHRASE',
    requiredIn: 'always',
    hint: 'Test SDF Network ; September 2015',
  },
  {
    name: 'CONTRACT_ID',
    requiredIn: 'production',
    hint: 'the deployed SwiftRemit contract id (C...)',
    // Injected by AWS Secrets Manager when enabled; nothing to validate here.
    skipIf: () => process.env.SECRETS_MANAGER_ENABLED === 'true',
  },
  {
    name: 'ADMIN_SECRET_KEY',
    requiredIn: 'production',
    hint: 'the admin Stellar secret key (S...)',
    skipIf: () => process.env.SECRETS_MANAGER_ENABLED === 'true',
  },
];

export interface EnvGuardResult {
  errors: string[];
  warnings: string[];
}

/** Pure evaluation — exported so it can be unit tested without exiting. */
export function evaluateEnv(
  requirements: EnvRequirement[],
  env: NodeJS.ProcessEnv,
  nodeEnv: string,
): EnvGuardResult {
  const isProduction = nodeEnv === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const req of requirements) {
    if (req.skipIf?.()) continue;

    const value = env[req.name];
    const mustHold = req.requiredIn === 'always' || isProduction;

    let problem: string | null = null;
    if (value === undefined || value === '') {
      problem = 'is not set';
    } else if (isPlaceholder(value)) {
      problem = `still holds the .env.example placeholder ${JSON.stringify(value)}`;
    }

    if (!problem) continue;

    const message = `${req.name} ${problem} — expected ${req.hint}`;
    if (mustHold) errors.push(message);
    else warnings.push(message);
  }

  return { errors, warnings };
}

/**
 * Validate the environment and abort the process when it is unusable.
 * Call this as the very first thing a service does.
 */
export function assertEnvConfigured(
  requirements: EnvRequirement[] = BACKEND_REQUIREMENTS,
  env: NodeJS.ProcessEnv = process.env,
  serviceName = 'backend',
): void {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const { errors, warnings } = evaluateEnv(requirements, env, nodeEnv);

  for (const warning of warnings) {
    console.warn(`[env] warning: ${warning}`);
  }

  if (errors.length === 0) return;

  console.error(
    `\n✗ ${serviceName} cannot start: ${errors.length} configuration problem(s) in NODE_ENV=${nodeEnv}\n`,
  );
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  console.error(
    '\nRun `make setup` (or ./scripts/setup-env.sh) to create the per-service .env' +
      '\nfiles from their .env.example templates, then fill in the remaining values.' +
      '\nDo not point Docker Compose at a .env.example — see SR-102.\n',
  );
  process.exit(1);
}

export { BACKEND_REQUIREMENTS };
