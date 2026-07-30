/**
 * SR-102 — fail startup when configuration is missing or still holds a
 * placeholder value copied out of .env.example.
 *
 * Twin of backend/src/env-guard.ts. The two services deploy independently and
 * share no package, so the logic is intentionally duplicated; only the
 * requirement list below differs.
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
 * service.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^$/,
  /^\s*$/,
  /change[-_ ]?me/i,
  /^your[-_]/i,
  /yourusername/i,
  /\byour[-_](secret|key|token|password|api[-_]?key)\b/i,
  /:\/\/user:password@/i,
  /^S?X{3,}/i,
  /^<.*>$/,
  /^(placeholder|example|dummy|todo|tbd|fixme)$/i,
  /^C?A{20,}/,
  /example\.com/i,
];

export function isPlaceholder(value: string | undefined): boolean {
  if (value === undefined) return false;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

const API_REQUIREMENTS: EnvRequirement[] = [
  {
    name: 'DATABASE_URL',
    requiredIn: 'always',
    hint: 'postgres://user:pass@host:5432/swiftremit',
  },
  {
    name: 'ANCHORS_ADMIN_API_KEY',
    requiredIn: 'always',
    hint: 'a random secret guarding the anchor admin routes',
  },
  {
    name: 'CURRENCY_CONFIG_PATH',
    requiredIn: 'always',
    hint: './config/currencies.json',
  },
  {
    name: 'JWT_SECRET',
    requiredIn: 'production',
    hint: 'a random secret used to sign access tokens',
    // Injected by AWS Secrets Manager when enabled; nothing to validate here.
    skipIf: () => process.env.SECRETS_MANAGER_ENABLED === 'true',
  },
  {
    name: 'CONTRACT_RPC_URL',
    requiredIn: 'production',
    hint: 'https://soroban-rpc.stellar.org',
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
  requirements: EnvRequirement[] = API_REQUIREMENTS,
  env: NodeJS.ProcessEnv = process.env,
  serviceName = 'api',
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

export { API_REQUIREMENTS };
