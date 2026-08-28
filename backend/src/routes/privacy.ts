import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { getPool } from '../database';
import { encryptColumn, decryptObject } from '../privacy/encryption';
import { RETENTION_POLICIES, checkAmlLegalHold, purgeExpiredPersonalData } from '../privacy/retention-service';

export const privacyRouter = Router();

const pool: Pool = getPool();

/**
 * Resolve the caller's own user id from a Bearer token, mirroring
 * resolveOwnerId in api.ts's developer-key endpoints. There is no full JWT
 * verification pipeline in this service yet; the bearer value is treated as
 * the caller's identity, same convention as /api/developers/keys.
 */
function resolveCallerId(req: Request): string | null {
  const auth = req.headers.authorization as string | undefined;
  if (auth?.startsWith('Bearer ')) return auth.slice(7) || null;
  return null;
}

/**
 * Only the data subject themselves, or an admin-scoped API key, may act on a
 * given user_id. Previously every one of these handlers trusted whatever
 * user_id was in the request body with no ownership check at all.
 */
function authorizeSubject(req: Request, res: Response, userId: string): boolean {
  const apiKey = (req as any).apiKey as { owner_id?: string; scopes?: string[] } | undefined;
  const isAdmin = !!apiKey?.scopes?.includes('admin:*');
  const isSelfViaApiKey = !!apiKey?.owner_id && apiKey.owner_id === userId;
  const isSelfViaBearer = resolveCallerId(req) === userId;

  if (isAdmin || isSelfViaApiKey || isSelfViaBearer) return true;

  res.status(403).json({ error: 'You may only act on your own privacy data' });
  return false;
}

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
 * Record user consent for privacy policy / marketing / terms against the
 * real user_consents table (previously an in-process Map that reset on
 * every restart and was never visible to any other request handler).
 */
privacyRouter.post('/consent', async (req: Request, res: Response) => {
  const { user_id, consent_type, policy_version, agreed = true } = req.body;

  if (!user_id || !consent_type || !policy_version) {
    return res.status(400).json({ error: 'Missing required fields: user_id, consent_type, policy_version' });
  }
  if (!authorizeSubject(req, res, user_id)) return;

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? null;

  try {
    const result = await pool.query(
      `INSERT INTO user_consents (user_id, consent_type, policy_version, agreed, ip_address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, consent_type, policy_version, agreed, agreed_at, revoked_at`,
      [user_id, consent_type, policy_version, Boolean(agreed), ip ? encryptColumn(ip) : null],
    );

    res.status(201).json({
      message: 'Consent recorded successfully',
      consent: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record consent' });
  }
});

/**
 * GET /api/v1/privacy/consent/:userId
 * Get user consent history.
 */
privacyRouter.get('/consent/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  if (!authorizeSubject(req, res, userId as string)) return;

  try {
    const result = await pool.query(
      `SELECT id, user_id, consent_type, policy_version, agreed, agreed_at, revoked_at
       FROM user_consents WHERE user_id = $1 ORDER BY agreed_at DESC`,
      [userId],
    );
    res.json({ user_id: userId, consents: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch consent history' });
  }
});

/**
 * POST /api/v1/privacy/subject-access
 * GDPR Subject Access Request (SAR). Exports the real PII-bearing rows for a
 * user — notification preferences, KYC status/uploads and consent history —
 * decrypting any column-encrypted fields for the export.
 */
privacyRouter.post('/subject-access', async (req: Request, res: Response) => {
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id parameter' });
  }
  if (!authorizeSubject(req, res, user_id)) return;

  try {
    const [prefsResult, kycStatusResult, kycUploadsResult, consentsResult] = await Promise.all([
      pool.query(`SELECT * FROM notification_preferences WHERE user_id = $1`, [user_id]),
      pool.query(
        `SELECT anchor_id, status, last_checked, expires_at FROM user_kyc_status WHERE user_id = $1`,
        [user_id],
      ),
      pool.query(
        `SELECT anchor_id, document_type, file_name, status, created_at FROM kyc_uploads WHERE user_id = $1`,
        [user_id],
      ),
      pool.query(
        `SELECT consent_type, policy_version, agreed, agreed_at, revoked_at FROM user_consents WHERE user_id = $1`,
        [user_id],
      ),
    ]);

    const rawPrefs = prefsResult.rows[0] ?? null;
    const profile = rawPrefs ? decryptObject(rawPrefs, ['email', 'phone']) : null;

    const lastActivity = kycStatusResult.rows[0]?.last_checked
      ? new Date(kycStatusResult.rows[0].last_checked)
      : new Date(0);

    res.json({
      user_id,
      exported_at: new Date().toISOString(),
      profile,
      kyc_status: kycStatusResult.rows,
      kyc_uploads: kycUploadsResult.rows,
      consents: consentsResult.rows,
      data_retention_info: {
        aml_legal_hold: checkAmlLegalHold(lastActivity),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compile subject access export' });
  }
});

/**
 * PUT /api/v1/privacy/rectify
 * Rectify user personal data. Email/phone are written to
 * notification_preferences with column-level encryption; preferred_locale is
 * written to user_profiles. Previously this wrote to an in-process Map that
 * no other part of the service — including subject-access above — ever read.
 */
privacyRouter.put('/rectify', async (req: Request, res: Response) => {
  const { user_id, email, phone_number, preferred_locale } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id parameter' });
  }
  if (!authorizeSubject(req, res, user_id)) return;

  try {
    if (email !== undefined || phone_number !== undefined) {
      await pool.query(
        `INSERT INTO notification_preferences (user_id, email, phone)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET email = COALESCE($2, notification_preferences.email),
               phone = COALESCE($3, notification_preferences.phone),
               updated_at = NOW()`,
        [user_id, email ? encryptColumn(email) : null, phone_number ? encryptColumn(phone_number) : null],
      );
    }

    if (preferred_locale) {
      await pool.query(
        `INSERT INTO user_profiles (user_id, preferred_locale)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET preferred_locale = $2, updated_at = NOW()`,
        [user_id, preferred_locale],
      );
    }

    res.json({
      message: 'Personal data rectified and re-encrypted successfully',
      user_id,
      updated_fields: Object.keys(req.body).filter((k) => k !== 'user_id'),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rectify personal data' });
  }
});

/**
 * POST /api/v1/privacy/erasure
 * Erasure request (Right to be forgotten) with AML Legal Hold Carve-Out.
 * Deletes/anonymizes real rows instead of a Map that nothing downstream
 * (Postgres, exports, other requests) ever saw.
 */
privacyRouter.post('/erasure', async (req: Request, res: Response) => {
  const { user_id, account_closed_at, has_financial_transactions = true } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id parameter' });
  }
  if (!authorizeSubject(req, res, user_id)) return;

  const closureDate = account_closed_at ? new Date(account_closed_at) : new Date();
  const amlHold = checkAmlLegalHold(closureDate);

  try {
    if (has_financial_transactions && amlHold.onHold) {
      // Carve-out: AML law mandates retention of transaction logs & verified KYC.
      await pool.query(`DELETE FROM notification_preferences WHERE user_id = $1`, [user_id]);
      await pool.query(
        `UPDATE user_consents SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
        [user_id],
      );
      await pool.query(
        `DELETE FROM kyc_uploads WHERE user_id = $1 AND status IN ('pending', 'failed')`,
        [user_id],
      );

      await pool.query(
        `INSERT INTO privacy_requests (user_id, request_type, status, details, legal_hold_carveout)
         VALUES ($1, 'erasure', 'legal_hold', $2, true)`,
        [
          user_id,
          JSON.stringify({
            erased: ['notification_preferences', 'marketing_consents', 'unverified_uploads'],
            retained: ['transaction_audit_logs', 'verified_kyc_status'],
            legal_hold_expiry: amlHold.releaseDate,
          }),
        ],
      );

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
    await pool.query(`DELETE FROM notification_preferences WHERE user_id = $1`, [user_id]);
    await pool.query(`DELETE FROM user_consents WHERE user_id = $1`, [user_id]);
    await pool.query(`DELETE FROM kyc_uploads WHERE user_id = $1`, [user_id]);
    await pool.query(
      `INSERT INTO privacy_requests (user_id, request_type, status, completed_at)
       VALUES ($1, 'erasure', 'completed', NOW())`,
      [user_id],
    );

    res.status(200).json({
      message: 'User personal data fully erased.',
      status: 'completed',
      legal_hold_carveout: false,
      erased_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process erasure request' });
  }
});

/**
 * POST /api/v1/privacy/purge-expired
 * Trigger manual purge of expired data. Now passes the real pg.Pool so
 * purgeExpiredPersonalData actually deletes rows instead of returning an
 * all-zero report — see privacy/retention-service.ts. Admin-scoped only.
 */
privacyRouter.post('/purge-expired', async (req: Request, res: Response) => {
  const apiKey = (req as any).apiKey as { scopes?: string[] } | undefined;
  if (!apiKey?.scopes?.includes('admin:*')) {
    return res.status(403).json({ error: 'Requires an admin:* scoped API key' });
  }

  try {
    const report = await purgeExpiredPersonalData(pool);
    res.json({
      message: 'Automated privacy data purge executed',
      report,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to execute privacy data purge' });
  }
});
