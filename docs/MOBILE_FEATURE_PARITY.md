# Mobile Feature Parity Matrix

## Overview
This document tracks feature parity between web frontend and mobile app. Mobile scope targets core remittance flows with essential compliance and user experience features.

## Core Remittance Features

| Feature | Web | Mobile | Status | Notes |
|---------|-----|--------|--------|-------|
| Send Money Flow | ✅ | ✅ | Complete | Basic 3-step flow implemented |
| Recipient Details (name, country, currency) | ✅ | ✅ | Complete | Mobile covers essential fields |
| Amount Entry | ✅ | ✅ | Complete | USD only, mirrors SR-073 |
| Biometric Authentication | ✅ | ✅ | Complete | Face ID / Fingerprint support |
| Transaction Confirmation | ✅ | ✅ | Complete | Review screen before send |
| Transaction History | ✅ | ✅ | Complete | List view with status indicators |
| Transaction Detail View | ✅ | ✅ | Complete | Basic details + status tracker |
| KYC Status Display | ✅ | ✅ | Complete | Status badge + instructions |

## Phase 1: Fee & Payout Features (SR-097 Scope)

| Feature | Web | Mobile | Status | Implementation |
|---------|-----|--------|--------|-----------------|
| Fee Preview with Breakdown | ✅ | ❌ → ✅ | In Progress | Add step 2.5 in send flow |
| Full Fee Breakdown (send fee, fx fee, payout fee) | ✅ | ❌ → ✅ | In Progress | Display in fee-preview component |
| Anchor Selection | ✅ | ❌ → ✅ | In Progress | Add step 2.7 or modal selection |
| Proof of Payout Display | ✅ | ⏳ | Backlog | After anchor confirmation |
| Corridor Comparison | ✅ | ⏳ | Backlog | Route analysis (low priority) |
| Fx Rate Trends | ✅ | ⏳ | Backlog | Educational feature (low priority) |

## Phase 2: Disputes & Receipts (SR-097 Scope)

| Feature | Web | Mobile | Status | Implementation |
|---------|-----|--------|--------|-----------------|
| Dispute Raising | ✅ | ❌ → ✅ | In Progress | Add to transaction detail |
| Dispute Reason Selection | ✅ | ❌ → ✅ | In Progress | Enum: funds_not_received, incorrect_amount, duplicate, other |
| Dispute Status Tracking | ✅ | ❌ → ✅ | In Progress | Status indicator in detail view |
| Receipt View | ✅ | ❌ → ✅ | In Progress | Full transaction receipt |
| Receipt Export (PDF) | ✅ | ❌ → ✅ | In Progress | Share PDF or save |
| Receipt Sharing | ✅ | ❌ → ✅ | In Progress | Share via system share sheet |

## Phase 3: Localization (SR-097 Scope)

| Feature | Web | Mobile | Status | Implementation |
|---------|-----|--------|--------|-----------------|
| English (en-US) | ✅ | ✅ | Complete | Default language |
| Spanish (es-ES) | ✅ | ❌ → ✅ | In Progress | i18n integration |
| French (fr-FR) | ✅ | ❌ → ✅ | In Progress | i18n integration |
| Portuguese (pt-BR) | ✅ | ❌ → ✅ | In Progress | i18n integration |
| RTL Layout Support | ✅ | ⏳ | Backlog | For Arabic/Hebrew (future) |

## Out of Scope (Phase 2+)

These web features are deprioritized for initial mobile release:
- Agent tooling (business-only)
- Advanced corridor analytics
- Batch remittances
- Real-time FX rate trends
- Complex dispute workflows
- Scheduled transfers

## Mobile Screens

### Current (5 screens)
1. **HomeScreen** — Dashboard, quick send, recent transfers
2. **SendMoneyScreen** — 3-step send flow (recipient → amount → review)
3. **TransactionHistoryScreen** — List of past transfers
4. **TransactionDetailScreen** — Status tracker, basic details
5. **KycStatusScreen** — KYC level, required docs, upgrade path

### Enhanced (maintain same 5, extend functionality)
1. HomeScreen — Add quick stats
2. SendMoneyScreen → SendMoneyFlow (expanded 5-step: recipient → amount → **fees** → **anchor** → review)
3. TransactionHistoryScreen — No change (filters added in Phase 2)
4. TransactionDetailScreen → Add dispute section + receipt
5. KycStatusScreen — No change

## Implementation Priority
1. **High** — Fee preview, anchor selection, dispute raising (core compliance + UX)
2. **Medium** — Receipt view, share/export (user-facing polish)
3. **Low** — Localization (can phase in by locale)

## Notes
- Mobile targets simplified feature set for remittance core flow
- No agent tooling (business-only, web reserved)
- Biometric auth is mobile-exclusive strength
- Localization deferred to Phase 2 if resources constrained
