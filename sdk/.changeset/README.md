# Changesets

This directory contains [Changesets](https://github.com/changesets/changesets) for versioning and changelog generation.

## Workflow

1. **Create a changeset** when starting work on a change that should be noted in the changelog:
   ```bash
   npm run changeset
   ```
   Select the semver bump type (`major`, `minor`, or `patch`) and describe the change.

2. **Version packages** before a release:
   ```bash
   npm run version-packages
   ```
   This reads pending changesets, bumps the version in `package.json`, updates `CHANGELOG.md`, and removes consumed changeset files.

3. **Publish** after merging to `main`:
   ```bash
   npm run release
   ```

## Rules

- Every PR that changes the SDK API or behavior must include a changeset.
- Breaking changes must be marked `major` and include a migration note in the changeset description.
- Patch bumps are for bug fixes; minor bumps are for new features; major bumps are for breaking changes.

## Migration Guides

For breaking changes, add a migration guide in `MIGRATION_GUIDE.md` (or a version-specific sub-guide) and link it from the changelog entry.
