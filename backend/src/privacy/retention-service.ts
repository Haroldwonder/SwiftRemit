/**
 * Data Retention & Automated Deletion Service
 * Manages retention periods and automated deletion of personal data according to GDPR & AML regulations.
 */

export interface RetentionPolicy {
  category: string;
  retentionDays: number;
  description: string;
  legalBasis: string;
}

export const RETENTION_POLICIES: Record<string, RetentionPolicy> = {
  AUDIT_LOG_IP: {
    category: 'Audit Log IP Addresses',
    retentionDays: 90,
    description: 'Administrative audit log IP addresses purged after 90 days',
    legalBasis: 'GDPR Art. 6(1)(f) Legitimate Interest',
  },
  TRANSIENT_KYC_UPLOADS: {
    category: 'Transient KYC Uploads',
    retentionDays: 30,
    description: 'Unverified or rejected transient KYC document uploads purged after 30 days',
    legalBasis: 'GDPR Art. 6(1)(c) / Minimization',
  },
  REVOKED_CONSENTS: {
    category: 'Revoked Consent History',
    retentionDays: 365,
    description: 'Revoked consent history retained for 1 year for auditability',
    legalBasis: 'GDPR Art. 6(1)(c) Compliance',
  },
  AML_LEGAL_HOLD: {
    category: 'AML Transaction & KYC Verification',
    retentionDays: 1825, // 5 years
    description: 'Mandatory 5-year legal hold on transaction history and verified KYC under AML/CTF laws',
    legalBasis: 'GDPR Art. 6(1)(c) Legal Obligation (AML/CTF)',
  },
};

export interface PurgeReport {
  timestamp: string;
  auditLogsAnonymized: number;
  transientKycPurged: number;
  revokedConsentsPurged: number;
  amlHoldRecordsRetained: number;
  errors: string[];
}

/**
 * Checks if a user's data is subject to an AML Legal Hold.
 * Retains records for 5 years (1825 days) post account closure or last transaction.
 */
export function checkAmlLegalHold(lastActivityDate: Date): { onHold: boolean; releaseDate: Date; reason: string } {
  const retentionMs = RETENTION_POLICIES.AML_LEGAL_HOLD.retentionDays * 24 * 60 * 60 * 1000;
  const releaseDate = new Date(lastActivityDate.getTime() + retentionMs);
  const now = new Date();

  const onHold = now < releaseDate;
  return {
    onHold,
    releaseDate,
    reason: onHold
      ? 'Records subject to mandatory 5-year AML/CTF statutory retention legal hold.'
      : 'Legal hold period expired.',
  };
}

/**
 * Automated purging routine for expired personal data.
 * Executes database deletions for records beyond retention thresholds.
 */
export async function purgeExpiredPersonalData(dbPool?: any): Promise<PurgeReport> {
  const report: PurgeReport = {
    timestamp: new Date().toISOString(),
    auditLogsAnonymized: 0,
    transientKycPurged: 0,
    revokedConsentsPurged: 0,
    amlHoldRecordsRetained: 0,
    errors: [],
  };

  if (!dbPool) {
    // If running in test mode without live db pool
    return report;
  }

  try {
    // 1. Anonymize/Clear audit log IPs older than 90 days
    const auditRes = await dbPool.query(
      `UPDATE admin_audit_log 
       SET ip_address = '0.0.0.0' 
       WHERE created_at < NOW() - INTERVAL '90 days' 
         AND ip_address IS NOT NULL 
         AND ip_address != '0.0.0.0'`
    );
    report.auditLogsAnonymized = auditRes.rowCount || 0;
  } catch (err: any) {
    report.errors.push(`Audit log purge error: ${err.message}`);
  }

  try {
    // 2. Delete unverified/rejected transient KYC uploads older than 30 days
    const kycRes = await dbPool.query(
      `DELETE FROM kyc_uploads 
       WHERE created_at < NOW() - INTERVAL '30 days' 
         AND status IN ('rejected', 'expired', 'abandoned')`
    );
    report.transientKycPurged = kycRes.rowCount || 0;
  } catch (err: any) {
    report.errors.push(`Transient KYC purge error: ${err.message}`);
  }

  try {
    // 3. Purge revoked consents older than 365 days
    const consentRes = await dbPool.query(
      `DELETE FROM user_consents 
       WHERE revoked_at IS NOT NULL 
         AND revoked_at < NOW() - INTERVAL '365 days'`
    );
    report.revokedConsentsPurged = consentRes.rowCount || 0;
  } catch (err: any) {
    report.errors.push(`Revoked consent purge error: ${err.message}`);
  }

  return report;
}
