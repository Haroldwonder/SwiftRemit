# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-08-31

Covers everything landed since `1.0.0`. Consumers on `1.0.0` from npm do not have
any of the fixes below.

### Added

- SR-083: contract-surface coverage — typed wrappers for the remaining contract
  methods, so every entry point on the deployed contract is reachable from the SDK
- SR-088: expanded `SwiftRemitMockClient` (`@swiftremit/sdk/testing`) to match the
  live client's surface, including a conformance suite that keeps the two in step
- SR-090: browser bundle (IIFE and tree-shakeable ESM) with a gzipped size budget
  enforced in CI, plus `CDN_USAGE.md`
- SR-090: input validation helpers `validateAmount` and `validateAddress`, applied
  before transaction building
- SR-194: previously unexported domain types, parsers, and encoders
  (`Escrow`, `AssetVerification`, `PauseRecord`, `FeeStrategy`, `FeeCorridor`,
  `RateLimitConfig`, `RateLimitStatus`, `TransactionRecord`, `MigrationSnapshot`,
  `BatchSettlementEntry`, `AdminOperationType`, `PendingOperation`, and their
  parse/encode functions)
- SR-195: `computeRecipientHash` and the `RecipientDetails` types for building the
  on-chain recipient hash off-chain
- SR-197: `parseU64ReturnValue(result)` decodes the ID returned by
  `create_remittance`, `create_escrow`, and `propose` from a submitted
  transaction's `returnValue`
- SR-198: `maxWaitMs` on `submitTransaction` / `submitSignedTransaction`, and the
  exported `TransactionTimeoutError`, `SubmitOptions`,
  `DEFAULT_CONFIRMATION_WAIT_MS`, `MAX_CONFIRMATION_POLLS`,
  `CONFIRMATION_POLL_INTERVAL_MS`
- SR-196: decoded event payload types — `DecodedEventData`,
  `RemittanceScopedEventData`, `ContractEventData`, `EventDataMap`,
  `RemittanceScopedEventType`, `AnyEventHandler`

### Changed

- SR-085: releases are published with npm provenance (`--provenance`)
- SR-087: retry policy hardening — writes default to no retries, reads honour
  `Retry-After`, and backoff is jittered to avoid a thundering herd
- SR-196: `EventHandler`'s `data` is now typed as `EventDataMap[T]` instead of
  `any`, so a handler that reads a field the event does not carry fails to compile

### Fixed

- SR-084: contract error codes map to `SwiftRemitError` with the correct code,
  message, remediation, and `retryable` flag
- SR-192/193: error code and mock parity gaps between the client and the mock
- SR-196: `client.on()` and `client.onAny()` handed handlers raw base64 XDR under
  `event.data`, so the documented `event.data.remittanceId` was always
  `undefined`. Handlers now receive decoded topics, a decoded value, and the
  remittance ID, with the wire form still available at `event.data.raw`
- SR-197: `examples/quickstart.ts` derived the new remittance's ID from
  `getRemittanceCount()`, which returns another sender's ID under concurrency. It
  now decodes the ID from the transaction's return value
- SR-198: the confirmation-polling loop in `submitSignedTransaction` had no
  deadline and no iteration cap, so a dropped transaction hung the caller forever.
  It now throws `TransactionTimeoutError` after `maxWaitMs` (default 90 s)

### Security

- SR-090: reject oversized and malformed inputs before they reach transaction
  building

[1.1.0]: https://github.com/GFOX/SwiftRemit/releases/tag/sdk-v1.1.0

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
