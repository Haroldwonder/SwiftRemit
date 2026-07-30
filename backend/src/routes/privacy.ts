import { Router, Request, Response } from 'express';
import { encryptColumn, decryptColumn, encryptObject, decryptObject } from '../privacy/encryption';
import { sanitizeString, sanitizeLogValue } from '../privacy/log-sanitizer';
import { RETENTION_POLICIES, checkAmlLegalHold, purgeExpiredPersonalData } from '../privacy/retention-service';

export const privacyRouter = Router();

// In-memory fallback stores for testing / local execution without live database
const mockConsentStore: Map<string, any[]> = new Map();
const mockUserProfiles: Map<string, any> = new Map();
const mockPrivacyRequests: Map<string, any[]> = new Map();

/**
 * GET /api/v1/privacy/policy
 * Returns the platform privacy policy, retention schedules, and data subject rights procedures.
 */
privacyRouter.get('/policy', (_req: Request, res: Response) => {
  res.json({
    policy_version: '1.0.0',
    effective_date: '2026-07-30',
    controller: 'SwiftRemit Data Protection Office',
    contact: 'privacy@swiftremit.io',
    lawful_bases: [
      { basis: 'Performance of Contract', description: 'Execution of remittances and account management (GDPR Art. 6(1)(b))' },
      { basis: 'Legal Obligation', description: 'AML/CTF compliance, identity verification, and reporting (GDPR Art. 6(1)(c))' },
      { basis: 'Legitimate Interest', description: 'System security, fraud detection, and audit logging (GDPR Art. 6(1)(f))' },
      { basis: 'Consent', description: 'Marketing communications and optional preferences (GDPR Art. 6(1)(a))' },
    ],
    retention_schedule: RETENTION_POLICIES,
    data_subject_rights: [
      'Right of Access (Subject Access Request)',
      'Right to Rectification',
      'Right to Erasure (Subject to AML Statutory Legal Hold)',
      'Right to Restrict Processing',
      'Right to Data Portability',
      'Right to Withdraw Consent',
    ],
  });
});

/**
 * POST /api/v1/privacy/consent
 * Record user consent for privacy policy / marketing / terms.
 */
privacyRouter.post('/consent', (req: Request, res: Response) => {
  const { user_id, consent_type, policy_version, agreed = true } = req.body;

  if (!user_id || !consent_type || !policy_version) {
    return res.status(400).json({ error: 'Missing required fields: user_id, consent_type, policy_version' });
  }

  const record = {
    id: `consent-${Date.now()}`,
    user_id,
    consent_type,
    policy_version,
    agreed: Boolean(agreed),
    agreed_at: new Date().toISOString(),
    ip_address: '[REDACTED_IP]', // Anonymized IP
  };

  const userConsents = mockConsentStore.get(user_id) || [];
  userConsents.push(record);
  mockConsentStore.set(user_id, userConsents);

  res.status(201).json({
    message: 'Consent recorded successfully',
    consent: record,
  });
});

/**
 * GET /api/v1/privacy/consent/:userId
 * Get user consent history.
 */
privacyRouter.get('/consent/:userId', (req: Request, res: Response) => {
  const { userId } = req.params;
  const consents = mockConsentStore.get(userId) || [];
  res.json({ user_id: userId, consents });
});

/**
 * POST /api/v1/privacy/subject-access
 * GDPR Subject Access Request (SAR). Export all user personal data with decrypted fields.
 */
privacyRouter.post('/subject-access', (req: Request, res: Response) => {
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id parameter' });
  }

  const rawProfile = mockUserProfiles.get(user_id) || {
    user_id,
    full_name: encryptColumn('Jane Doe'),
    email: encryptColumn('jane.doe@example.com'),
    phone_number: encryptColumn('+15551234567'),
    address: encryptColumn('123 Main St, New York, NY'),
    created_at: new Date().toISOString(),
  };

  // Decrypt sensitive PII for data subject export
  const decryptedProfile = decryptObject(rawProfile, ['full_name', 'email', 'phone_number', 'address']);
  const consents = mockConsentStore.get(user_id) || [];

  res.json({
    user_id,
    exported_at: new Date().toISOString(),
    profile: decryptedProfile,
    consents,
    data_retention_info: {
      aml_legal_hold: checkAmlLegalHold(new Date()),
    },
  });
});

/**
 * PUT /api/v1/privacy/rectify
 * Rectify user personal data with column-level encryption.
 */
privacyRouter.put('/rectify', (req: Request, res: Response) => {
  const { user_id, full_name, email, phone_number, address } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id parameter' });
  }

  const existingProfile = mockUserProfiles.get(user_id) || { user_id };

  const updatedProfile = {
    ...existingProfile,
    user_id,
    full_name: full_name ? encryptColumn(full_name) : existingProfile.full_name,
    email: email ? encryptColumn(email) : existingProfile.email,
    phone_number: phone_number ? encryptColumn(phone_number) : existingProfile.phone_number,
    address: address ? encryptColumn(address) : existingProfile.address,
    updated_at: new Date().toISOString(),
  };

  mockUserProfiles.set(user_id, updatedProfile);

  res.json({
    message: 'Personal data rectified and re-encrypted successfully',
    user_id,
    updated_fields: Object.keys(req.body).filter(k => k !== 'user_id'),
  });
});

/**
 * POST /api/v1/privacy/erasure
 * Erasure request (Right to be forgotten) with AML Legal Hold Carve-Out.
 */
privacyRouter.post('/erasure', (req: Request, res: Response) => {
  const { user_id, account_closed_at, has_financial_transactions = true } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id parameter' });
  }

  const closureDate = account_closed_at ? new Date(account_closed_at) : new Date();
  const amlHold = checkAmlLegalHold(closureDate);

  if (has_financial_transactions && amlHold.onHold) {
    // Carve-out: AML law mandates retention of transaction logs & KYC records
    const requestRecord = {
      id: `req-${Date.now()}`,
      user_id,
      request_type: 'erasure',
      status: 'legal_hold',
      legal_hold_carveout: true,
      erased_items: ['notification_preferences', 'marketing_consents', 'unverified_uploads'],
      retained_items: ['transaction_audit_logs', 'verified_kyc_status'],
      legal_hold_expiry: amlHold.releaseDate.toISOString(),
      requested_at: new Date().toISOString(),
    };

    const userReqs = mockPrivacyRequests.get(user_id) || [];
    userReqs.push(requestRecord);
    mockPrivacyRequests.set(user_id, userReqs);

    // Erase non-essential data (marketing / profile preferences)
    mockConsentStore.delete(user_id);

    return res.status(200).json({
      message: 'Erasure request processed with AML Legal Hold carve-out.',
      status: 'legal_hold',
      legal_hold_carveout: true,
      details: amlHold.reason,
      legal_hold_expiry: amlHold.releaseDate.toISOString(),
      erased_categories: ['notification_preferences', 'marketing_consents', 'unverified_uploads'],
      retained_categories_under_legal_hold: ['transaction_audit_logs', 'verified_kyc_status'],
    });
  }

  // Full erasure if no legal hold applies
  mockUserProfiles.delete(user_id);
  mockConsentStore.delete(user_id);

  res.status(200).json({
    message: 'User personal data fully erased.',
    status: 'completed',
    legal_hold_carveout: false,
    erased_at: new Date().toISOString(),
  });
});

/**
 * POST /api/v1/privacy/purge-expired
 * Trigger manual or scheduled purge of expired data.
 */
privacyRouter.post('/purge-expired', async (_req: Request, res: Response) => {
  const report = await purgeExpiredPersonalData();
  res.json({
    message: 'Automated privacy data purge executed',
    report,
  });
});
