# Security Policy

SwiftRemit handles escrow-based remittance flows and USDC settlement logic. Please report vulnerabilities privately so the maintainers can triage and remediate issues before public disclosure.

## Responsible Disclosure

Use the following channels for security reports:

- Preferred: GitHub private vulnerability reporting for this repository, if enabled.
- Email: security@swiftremit.app. If this mailbox is not yet provisioned, maintainers should route reports through GitHub private vulnerability reporting until the dedicated disclosure inbox is active.

Please do not open public GitHub issues for exploitable vulnerabilities. Include enough detail for maintainers to reproduce the issue safely, such as affected component, steps to reproduce, expected impact, proof-of-concept code, and any relevant transaction IDs or logs from testnet.

## In Scope

The following assets are in scope when they are owned or operated by SwiftRemit:

- Soroban smart contracts for testnet and mainnet deployments.
- Contract authorization, escrow, settlement, fee, dispute, rate-limit, and admin-control logic.
- Public API endpoints, backend workers, webhook handlers, and environment-dependent configuration.
- Frontend flows that create, sign, submit, or display remittance transactions.
- Deployment scripts, CI/CD configuration, and production infrastructure configuration stored in this repository.

## Out of Scope

The following findings are out of scope unless they demonstrate a clear security impact on SwiftRemit-owned assets:

- Social engineering, phishing, physical attacks, or attempts to access employee or maintainer accounts.
- Denial-of-service testing, stress testing, spam, or automated scans that degrade service availability.
- Vulnerabilities in third-party services, wallets, explorers, RPC providers, bridges, or Stellar infrastructure not controlled by SwiftRemit.
- Reports based only on missing security headers, version disclosure, clickjacking, or best-practice deviations without an exploitable impact.
- Publicly known vulnerabilities without a working SwiftRemit-specific exploit path.
- Issues requiring leaked credentials, compromised private keys, or privileged access that the reporter did not obtain through an in-scope vulnerability.

## Response SLA

SwiftRemit aims to follow this response timeline:

- Acknowledge receipt within 3 business days.
- Provide an initial triage decision within 7 business days.
- Share a remediation plan or status update within 14 business days for confirmed high-impact issues.
- Coordinate public disclosure only after a fix, mitigation, or mutually agreed disclosure date is ready.

Severity, exploitability, and affected network determine final remediation timing. Critical issues affecting user funds or contract administration should be prioritized immediately.

## Safe Harbor

Security research performed in good faith is welcome when it stays within the defined scope, avoids privacy violations, avoids service disruption, and gives maintainers a reasonable opportunity to fix the issue before public disclosure. Researchers must not move, drain, or permanently lock funds, modify data that does not belong to them, or access secrets beyond what is necessary to demonstrate impact.

## Bounty Notes

This policy defines the disclosure scope and process. It does not guarantee a reward unless SwiftRemit publishes a separate bug bounty program or confirms a reward for a specific report.