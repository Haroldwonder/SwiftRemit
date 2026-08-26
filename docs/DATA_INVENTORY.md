# Data Inventory & Privacy Classification Matrix

This document provides a comprehensive inventory of personal data collected, stored, processed, and retained by the SwiftRemit platform, in compliance with GDPR (General Data Protection Regulation), CCPA, and applicable global data protection regimes.

---

## Data Inventory Matrix

| Table Name | Fields Stored | Data Category | Purpose of Processing | Retention Period | Lawful Basis (GDPR) | Encryption at Rest |
|------------|---------------|---------------|-----------------------|------------------|--------------------|-------------------|
| `user_profiles` | `full_name`, `email`, `phone_number`, `address` | Identity & Contact | Account management, transaction processing, communication | Active account duration + 5 years post-closure | Art. 6(1)(b) Performance of Contract | Column-level AES-256-GCM |
| `user_kyc_status` | `verification_data` (SSN/Tax ID, DOB, ID docs), `rejection_reason` | KYC / Sensitive PII | Regulatory compliance, AML/CTF identity verification | 5 years post account closure (AML Legal Hold) | Art. 6(1)(c) Legal Obligation | Column-level AES-256-GCM |
| `agent_kyc` | `id_number`, `full_name`, `email`, `document_url` | Agent Identity / Sensitive PII | Agent onboarding and regulatory verification | 5 years post termination (AML Legal Hold) | Art. 6(1)(c) Legal Obligation | Column-level AES-256-GCM |
| `kyc_uploads` | `document_url`, `document_type` | Identity Documents | Supporting documentation for KYC verification | 5 years post closure; 30 days for abandoned uploads | Art. 6(1)(c) Legal Obligation | Column-level AES-256-GCM |
| `notification_preferences` | `email`, `phone_number`, `preferred_language` | Contact / Preferences | Delivery of transaction alerts and security updates | Until consent withdrawal or account deletion | Art. 6(1)(a) Consent / Art. 6(1)(b) Contract | Column-level AES-256-GCM |
| `admin_audit_log` | `ip_address`, `user_id`, `action` | Operational / Technical PII | Security auditing, threat detection, administrative compliance | 90 days | Art. 6(1)(f) Legitimate Interest | Column-level / Anonymized |
| `transactions` | `account_id`, payment details, counterparty info | Financial / Transactional | Remittance execution, settlement, audit trail | 5 years post transaction completion (AML mandate) | Art. 6(1)(b) Contract & Art. 6(1)(c) Legal Obligation | Database-level encryption |
| `webhook_logs` | `request_headers`, `payload`, origin IP address | Technical PII | Delivery debugging and integration auditing | 30 days | Art. 6(1)(f) Legitimate Interest | Payload sanitization |
| `user_consents` | `consent_type`, `version`, `agreed_at`, `ip_address` | Compliance / Consent | Audit log of user consent for terms & privacy policies | Duration of account + 5 years | Art. 6(1)(c) Legal Obligation | Column-level AES-256-GCM |

---

## Data Minimization & Security Controls

1. **Column-Level Encryption**: All sensitive fields containing PII (including SSNs, tax identifiers, national IDs, email addresses, phone numbers, and full names) are encrypted at rest using AES-256-GCM authenticated encryption before database insertion.
2. **Log Sanitization**: Logs, traces, and error reports automatically redact email addresses, IP addresses, tax identifiers, credit card numbers, and authorization headers using pre-formatting sanitizers (`log-sanitizer.ts`).
3. **AML Legal Hold Carve-Out**: Under international Anti-Money Laundering (AML) and Counter-Financing of Terrorism (CFT) laws, transactional data and KYC verification logs are retained under a mandatory 5-year legal hold before final erasure.
4. **Automated Purging**: Automated retention routines periodically purge expired transient records, audit log IPs exceeding 90 days, and revoked consent records.
