# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Dark mode support with CSS custom properties and theme toggle component
- Correlation ID propagation from API through to webhook delivery
- CHANGELOG.md following Keep a Changelog format
- Automated release workflow with GitHub Actions

### Fixed
- `withdraw_integrator_fees` correctly returns `NoFeesToWithdraw` when balance is zero

## [1.0.0] - 2024-01-15

### Added
- Escrow-based remittance system with USDC on Stellar/Soroban
- Agent network registration and management
- Automated fee collection and withdrawal
- Lifecycle state management (Pending, Processing, Completed, Cancelled)
- Role-based access control for all operations
- Comprehensive event emission for off-chain monitoring
- Cancellation support with full refund capability
- Admin controls for platform fee management
- Daily send limits per currency/country with rolling 24h windows
- Off-chain proof commitments with optional validation
- Asset verification via Stellar Expert API and stellar.toml
- Circuit breaker for emergency pause functionality
- Rate limiting and abuse protection
- Webhook system with HMAC signature verification
- Webhook delivery retry with exponential backoff
- Dead-letter queue for failed webhook deliveries
- KYC integration with anchor services
- FX rate caching and currency conversion API
- Transaction state machine with enforced transitions
- Health check endpoints for monitoring
- OpenAPI documentation
- Property-based testing for fee calculations
- Integration tests for contract upgrade scenarios
- Frontend React application with Stellar wallet integration
- TypeScript SDK for contract interaction
- PostgreSQL backend for off-chain data
- Docker containerization for all services
- CI/CD pipeline with GitHub Actions

### Security
- HMAC-SHA256 webhook signature verification
- XSS sanitization for user inputs
- Admin audit logging
- Blacklist functionality for malicious actors
- Token whitelist for approved assets

