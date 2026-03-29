# Requirements Document

## Introduction

This feature adds automated validation to ensure that every environment variable consumed by source code is documented in the corresponding `.env.example` file. The repo contains five `.env.example` files (root, `frontend/`, `api/`, `backend/`, `examples/`) and source code spread across JavaScript/TypeScript and Vite-based frontend files. A lightweight Node.js script diffs variable names between source files and `.env.example` files, and a GitHub Actions workflow runs the script on every pull request so CI fails when documentation falls out of sync.

## Glossary

- **Validator**: The Node.js script (`scripts/validate-env-examples.js`) that performs the env variable diff.
- **Env_Example**: A `.env.example` file that documents the environment variables expected by a sub-project.
- **Source_File**: Any `.js`, `.ts`, `.tsx`, or `.jsx` file that references environment variables via `process.env.VAR` or `import.meta.env.VAR`.
- **CI_Workflow**: The GitHub Actions workflow (`.github/workflows/env-example-validation.yml`) that runs the Validator on every pull request.
- **Ignore_List**: A per-scope set of variable names that the Validator intentionally skips (e.g., dynamic or framework-internal variables).

## Requirements

### Requirement 1: Detect Missing Variables

**User Story:** As a developer, I want the validation script to detect env variables used in source code but absent from the corresponding `.env.example`, so that documentation gaps are caught automatically.

#### Acceptance Criteria

1. WHEN the Validator runs against a scope, THE Validator SHALL extract every environment variable name matched by the scope's regex pattern from all Source_Files in that scope.
2. WHEN the Validator runs against a scope, THE Validator SHALL extract every variable name defined in the corresponding Env_Example file (non-comment, non-blank lines, key portion before `=`).
3. WHEN a variable name is present in Source_Files but absent from the Env_Example and not in the Ignore_List, THE Validator SHALL report that variable name as missing and exit with a non-zero status code.
4. WHEN all variable names found in Source_Files are either present in the Env_Example or in the Ignore_List, THE Validator SHALL exit with status code 0.
5. THE Validator SHALL support at least four scopes: root (targeting `examples/**/*.js`), `api/` (targeting `api/src/**/*.ts`), `backend/` (targeting `backend/src/**/*.ts`), and `frontend/` (targeting `frontend/src/**/*.{ts,tsx,js,jsx}`).
6. WHEN the Env_Example file for a scope does not exist, THE Validator SHALL report the missing file and exit with a non-zero status code.

### Requirement 2: Pattern-Based Variable Extraction

**User Story:** As a developer, I want the script to correctly extract env variable references for both Node.js and Vite-style access patterns, so that all variable usages are covered regardless of the framework.

#### Acceptance Criteria

1. THE Validator SHALL extract variables accessed via `process.env.VARIABLE_NAME` using the pattern `/process\.env\.([A-Z][A-Z0-9_]+)/g`.
2. THE Validator SHALL extract variables accessed via `import.meta.env.VITE_VARIABLE_NAME` using the pattern `/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g`.
3. WHEN a scope is configured with a specific extraction pattern, THE Validator SHALL apply only that pattern to the Source_Files in that scope.
4. THE Validator SHALL ignore variable names that match entries in the scope's Ignore_List regardless of whether they appear in the Env_Example.

### Requirement 3: CI Integration

**User Story:** As a developer, I want the validation script to run automatically on every pull request, so that missing env variable documentation is caught before code is merged.

#### Acceptance Criteria

1. THE CI_Workflow SHALL trigger on every pull request targeting the `main` branch.
2. THE CI_Workflow SHALL trigger on pushes to `main` when any `.env.example` file, the Validator script, or monitored source directories are modified.
3. WHEN the Validator exits with a non-zero status code, THE CI_Workflow SHALL fail the pull request check.
4. WHEN the Validator exits with status code 0, THE CI_Workflow SHALL pass the pull request check.
5. THE CI_Workflow SHALL run the Validator using Node.js 20.x.

### Requirement 4: Local Execution

**User Story:** As a developer, I want to run the validation script locally before pushing, so that I can fix documentation gaps without waiting for CI.

#### Acceptance Criteria

1. THE Validator SHALL be executable locally with a single command: `node scripts/validate-env-examples.js`.
2. WHEN run locally, THE Validator SHALL produce the same output and exit codes as when run in CI.
3. THE Validator SHALL require no additional installation steps beyond having Node.js available (no extra `npm install` required).

### Requirement 5: Developer Documentation

**User Story:** As a developer, I want the README to document how to run the validation script locally, so that I can quickly understand how to use and maintain the tooling.

#### Acceptance Criteria

1. THE README SHALL include a section describing the env variable validation script and its purpose.
2. THE README SHALL document the exact command to run the Validator locally.
3. THE README SHALL describe how to add a new variable to an Env_Example file when the Validator reports it as missing.
4. THE README SHALL describe how to add a new scope or update the Ignore_List when a new sub-project is introduced.
