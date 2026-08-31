# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-08-31

### Fixed

- SR-086: `submitSigned` re-signed a transaction that the signer had already
  signed, producing a second signature on the envelope and a submission the
  network rejected. It now submits the signed transaction as-is.

## [1.0.0] - 2026-06-28

### Added

- Initial release of `@swiftremit/react-native-sdk`
- React Native client wrapper over `@swiftremit/sdk`
- `SwiftRemitSigner` abstraction for wallet-held keys
- React hooks for remittance creation, status polling, and event subscription
