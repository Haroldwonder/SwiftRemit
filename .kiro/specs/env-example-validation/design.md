# Design Document: env-example-validation

## Overview

The env-example-validation feature ensures that every environment variable consumed by source code is documented in the corresponding `.env.example` file. A Node.js script (`scripts/validate-env-examples.js`) performs the diff and a GitHub Actions workflow runs it on every pull request. Both artifacts already exist in the repo; this spec formalises their behaviour, identifies gaps, and adds the missing README documentation.

The script is intentionally dependency-free — it uses only Node.js built-ins (`fs`, `path`, `child_process`) so it can run in CI without an `npm install` step.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  GitHub Actions CI_Workflow                         │
│  .github/workflows/env-example-validation.yml       │
│                                                     │
│  on: pull_request / push to main                    │
│       │                                             │
│       ▼                                             │
│  node scripts/validate-env-examples.js              │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  Validator  (scripts/validate-env-examples.js)      │
│                                                     │
│  for each SCOPE in CHECKS:                          │
│    used    = extractFromSources(scope.sources,      │
│                                 scope.pattern)      │
│    defined = extractFromExample(scope.envExample)   │
│    missing = used − defined − scope.ignore          │
│    if missing.length > 0 → print error, failed=true │
│                                                     │
│  exit(failed ? 1 : 0)                               │
└─────────────────────────────────────────────────────┘
```

## Components and Interfaces

### CHECKS Configuration Array

Each entry in `CHECKS` describes one scope:

```js
{
  name: string,          // human-readable label for error output
  sources: string[],     // glob patterns relative to repo root
  envExample: string,    // path to .env.example relative to repo root
  pattern: RegExp,       // regex with one capture group for the var name
  ignore: Set<string>,   // variable names to skip
}
```

Current scopes:

| name | sources | envExample | pattern |
|------|---------|------------|---------|
| `root (examples/)` | `examples/**/*.js` | `.env.example` | `process.env.VAR` |
| `api/` | `api/src/**/*.ts` | `api/.env.example` | `process.env.VAR` |
| `backend/` | `backend/src/**/*.ts` | `backend/.env.example` | `process.env.VAR` |
| `frontend/` | `frontend/src/**/*.{ts,tsx,js,jsx}` | `frontend/.env.example` | `import.meta.env.VITE_VAR` |

### extractFromSources(sources, pattern)

Walks all files matched by the glob patterns and applies the regex to collect variable names. Returns a `Set<string>`.

### extractFromExample(envExamplePath)

Reads the `.env.example` file, strips comment lines (`#`) and blank lines, splits on `=`, and returns the key portion as a `Set<string>`.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All scopes in sync |
| `1` | One or more variables missing from an Env_Example |

## Data Models

```
Scope {
  name:       string
  sources:    string[]
  envExample: string
  pattern:    RegExp
  ignore:     Set<string>
}

ValidationResult {
  scope:   Scope
  missing: string[]   // variables in source but not in .env.example
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Property 1: Env_Example parser extracts all defined keys
*For any* `.env.example` file content, `extractFromExample` should return exactly the set of non-comment, non-blank keys (the portion before `=` on each line).
**Validates: Requirements 1.2**

Property 2: Missing variable detection is complete and sound
*For any* set of used variable names U, defined variable names D, and ignore set I, the reported missing set should equal exactly `U − (D ∪ I)` — no more, no less.
**Validates: Requirements 1.3, 1.4, 2.4**

Property 3: Pattern isolation between scopes
*For any* source file containing only `import.meta.env.VITE_FOO` references, a scope configured with the `process.env` pattern should report zero extracted variables; and vice versa.
**Validates: Requirements 2.3**

## Error Handling

| Situation | Behaviour |
|-----------|-----------|
| Env_Example file does not exist | Print error naming the missing file; set `failed = true`; continue checking remaining scopes |
| Source file cannot be read | Skip the file; continue |
| No source files match a glob | Scope reports zero used variables (not an error) |
| Script invoked with no Node.js | OS-level error; out of scope |

## Testing Strategy

### Dual Testing Approach

Both unit tests and property-based tests are used:

- **Unit tests** cover specific examples, edge cases (missing `.env.example`, empty files, comment-only files), and the four-scope configuration.
- **Property tests** verify universal correctness across randomly generated inputs.

### Property-Based Testing

Use [fast-check](https://github.com/dubzzz/fast-check) (zero-config, works with Node's built-in test runner or Jest/Vitest).

Each property test runs a minimum of 100 iterations.

Tag format: `Feature: env-example-validation, Property {N}: {title}`

| Property | Test description |
|----------|-----------------|
| Property 1 | Generate random key=value lines mixed with comments; verify parser output |
| Property 2 | Generate random U, D, I sets; verify missing = U − (D ∪ I) |
| Property 3 | Generate source content with only one pattern type; verify the other pattern extracts nothing |

### Unit Test Cases

- Validator exits 0 when all vars are in sync (happy path for each scope)
- Validator exits 1 and names the missing variable when one is absent
- Validator exits 1 when the `.env.example` file does not exist
- Comment lines and blank lines in `.env.example` are not treated as variable definitions
- Variables in the Ignore_List are not reported as missing even when absent from `.env.example`
- The CHECKS array contains entries for all four required scopes
