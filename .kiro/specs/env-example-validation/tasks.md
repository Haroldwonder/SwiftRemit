# Implementation Plan: env-example-validation

## Overview

The core script and CI workflow already exist. The remaining work is: harden the script's file-finding logic (replace the fragile `find`-based glob with a proper recursive walk), add error handling for a missing `.env.example`, write tests, and add README documentation.

## Tasks

- [ ] 1. Harden the Validator script
  - [ ] 1.1 Replace the `findFiles` / `glob` shell-out helpers with a pure Node.js recursive directory walker
    - Remove the `child_process.execSync` calls used for file discovery
    - Implement a `walkFiles(dir, extensions)` function using `fs.readdirSync` / `fs.statSync`
    - Update each scope's source resolution to use the new walker
    - _Requirements: 4.3_
  - [ ] 1.2 Add missing-Env_Example error handling
    - In `extractFromExample`, when the file does not exist, print a descriptive error and return `null`
    - In the main loop, treat a `null` result as a failure (set `failed = true`, skip diff for that scope)
    - _Requirements: 1.6_
  - [ ]* 1.3 Write unit tests for `extractFromExample`
    - Test: normal key=value lines are parsed correctly
    - Test: comment lines (`#`) are excluded
    - Test: blank lines are excluded
    - Test: missing file returns null and sets failed
    - _Requirements: 1.2, 1.6_
  - [ ]* 1.4 Write unit tests for `extractFromSources`
    - Test: `process.env.VAR` pattern extracts correct names
    - Test: `import.meta.env.VITE_VAR` pattern extracts correct names
    - Test: a scope using the `process.env` pattern does not extract `import.meta.env` vars (pattern isolation)
    - _Requirements: 2.1, 2.2, 2.3_

- [ ] 2. Write property-based tests
  - [ ]* 2.1 Write property test for Env_Example parser (Property 1)
    - **Property 1: Env_Example parser extracts all defined keys**
    - Use fast-check to generate random arrays of key=value lines mixed with comment and blank lines
    - Assert `extractFromExample` output equals exactly the generated keys
    - Minimum 100 iterations
    - **Validates: Requirements 1.2**
  - [ ]* 2.2 Write property test for missing variable detection (Property 2)
    - **Property 2: Missing variable detection is complete and sound**
    - Use fast-check to generate random sets U (used), D (defined), I (ignored)
    - Assert reported missing set equals `U − (D ∪ I)`
    - Minimum 100 iterations
    - **Validates: Requirements 1.3, 1.4, 2.4**
  - [ ]* 2.3 Write property test for pattern isolation (Property 3)
    - **Property 3: Pattern isolation between scopes**
    - Use fast-check to generate source content containing only `import.meta.env.VITE_*` references
    - Assert that applying the `process.env` pattern extracts zero variables, and vice versa
    - Minimum 100 iterations
    - **Validates: Requirements 2.3**

- [ ] 3. Checkpoint — ensure all tests pass
  - Run `node --test scripts/validate-env-examples.test.js` (or equivalent test command)
  - Ensure all unit and property tests pass before proceeding
  - Ask the user if any questions arise

- [ ] 4. Verify CI workflow coverage
  - [ ] 4.1 Confirm the CI_Workflow triggers on all pull requests to `main`
    - Review `.github/workflows/env-example-validation.yml`
    - Ensure `pull_request` trigger has no path filter (runs on every PR, not just env-related changes)
    - _Requirements: 3.1_
  - [ ] 4.2 Confirm the CI_Workflow uses Node.js 20.x
    - Verify `node-version: 20.x` in the workflow setup step
    - _Requirements: 3.5_

- [ ] 5. Add README documentation
  - [ ] 5.1 Add an "Env Variable Validation" section to the root `README.md`
    - Describe the purpose of the script
    - Document the local run command: `node scripts/validate-env-examples.js`
    - Explain how to fix a failure: add the missing variable to the relevant `.env.example`
    - Explain how to add a new scope or update the Ignore_List for a new sub-project
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 6. Final checkpoint — ensure all tests pass
  - Run the full test suite and the validator script itself
  - Ensure all tests pass, ask the user if questions arise
