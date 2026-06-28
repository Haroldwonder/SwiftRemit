# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-28

### Added

- Initial public release of `@swiftremit/sdk`
- `SwiftRemitClient` with typed read/write wrappers for all contract methods
- Governance helpers: `getProposal`, `getActiveProposals`, `voteOnProposal`, `executeProposal`
- New high-level governance utilities:
  - Typed proposal builder functions (`buildUpdateFeeProposal`, `buildAddAdminProposal`, etc.)
  - `getVoteStatus(proposalId, voterAddress)` — query individual vote state
  - `propose(action)` — submit a typed proposal transaction
- `parseProposal` and other ScVal → native parsers
- Memory-backed `proposalActionToScVal` encoder for compute-cost governance transactions
- Utilities: `toStroops`, `fromStroops`, `USDC_MULTIPLIER`
- Event subscription via Horizon SSE (`subscribeToRemittanceEvents`)
- React Native wrapper (`@swiftremit/react-native-sdk`) with signer abstraction and hooks
- Full TypeScript declaration files (`.d.ts`)

### Changed

- `ProposalAction` type expanded to include all contract variants (`UpdateCooldownPeriod`, `WhitelistAsset`, `AdjustReputationThreshold`)

### Fixed

- Correct bigint/number conversions for parser-returned contract values

### Security

- HTTP transport allowed only for localhost/127.0.0.1; warns on insecure RPC URLs

[1.0.0]: https://github.com/GFOX/SwiftRemit/releases/tag/sdk-v1.0.0
