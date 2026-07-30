import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { encryptColumn, decryptColumn, isEncrypted, encryptObject, decryptObject } from '../privacy/encryption';
import { sanitizeString, sanitizeLogValue } from '../privacy/log-sanitizer';
import { RETENTION_POLICIES, checkAmlLegalHold } from '../privacy/retention-service';
import app from '../api';

describe('SR-113: Privacy & Data Protection Review', () => {
  describe('Column-Level Encryption at Rest', () => {
    it('encrypts sensitive text with AES-256-GCM enc:v1 prefix', () => {
      const plaintext = '123-45-6789';
      const encrypted = encryptColumn(plaintext);

      expect(encrypted).toBeDefined();
      expect(isEncrypted(encrypted)).toBe(true);
      expect(encrypted).toContain('enc:v1:');
      expect(encrypted).not.toContain(plaintext);
    });

    it('decrypts encrypted column back to original plaintext', () => {
      const original = 'john.doe@example.com';
      const encrypted = encryptColumn(original)!;
      const decrypted = decryptColumn(encrypted);

      expect(decrypted).toBe(original);
    });

    it('does not re-encrypt already encrypted text', () => {
      const original = 'sensitive_data';
      const enc1 = encryptColumn(original)!;
      const enc2 = encryptColumn(enc1);

      expect(enc1).toBe(enc2);
    });

    it('handles object field encryption and decryption', () => {
      const profile = {
        id: 'usr-123',
        full_name: 'Alice Smith',
        email: 'alice@example.com',
        role: 'user',
      };

      const encryptedObj = encryptObject(profile, ['full_name', 'email']);
      expect(isEncrypted(encryptedObj.full_name)).toBe(true);
      expect(isEncrypted(encryptedObj.email)).toBe(true);
      expect(encryptedObj.role).toBe('user');

      const decryptedObj = decryptObject(encryptedObj, ['full_name', 'email']);
      expect(decryptedObj.full_name).toBe('Alice Smith');
      expect(decryptedObj.email).toBe('alice@example.com');
    });
  });

  describe('Log Sanitization & PII Redaction', () => {
    it('redacts email addresses from log text', () => {
      const raw = 'User admin@swiftremit.io logged in from server';
      const sanitized = sanitizeString(raw);
      expect(sanitized).toBe('User [REDACTED_EMAIL] logged in from server');
    });

    it('redacts IP addresses from log text', () => {
      const raw = 'Connection attempt from 192.168.1.100 failed';
      const sanitized = sanitizeString(raw);
      expect(sanitized).toBe('Connection attempt from [REDACTED_IP] failed');
    });

    it('redacts SSN/Tax IDs and Stellar Secret Keys', () => {
      const raw = 'SSN is 987-65-4321 and secret key is SBX1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE';
      const sanitized = sanitizeString(raw);
      expect(sanitized).toContain('[REDACTED_TAX_ID]');
      expect(sanitized).toContain('[REDACTED_SECRET_KEY]');
    });

    it('recursively redacts sensitive keys from objects', () => {
      const payload = {
        action: 'user_login',
        email: 'user@domain.com',
        details: {
          ip_address: '10.0.0.1',
          token: 'secret-auth-token-123',
        },
      };

      const sanitized = sanitizeLogValue(payload) as any;
      expect(sanitized.email).toBe('[REDACTED_EMAIL]');
      expect(sanitized.details.ip_address).toBe('[REDACTED_IP_ADDRESS]');
      expect(sanitized.details.token).toBe('[REDACTED_TOKEN]');
    });
  });

  describe('Data Retention & AML Legal Hold', () => {
    it('defines retention schedules for data categories', () => {
      expect(RETENTION_POLICIES.AUDIT_LOG_IP.retentionDays).toBe(90);
      expect(RETENTION_POLICIES.AML_LEGAL_HOLD.retentionDays).toBe(1825);
    });

    it('enforces AML legal hold within 5-year statutory window', () => {
      const recentActivity = new Date();
      const holdStatus = checkAmlLegalHold(recentActivity);

      expect(holdStatus.onHold).toBe(true);
      expect(holdStatus.reason).toContain('mandatory 5-year AML/CTF statutory retention');
    });

    it('releases AML legal hold after 5 years', () => {
      const oldActivity = new Date(Date.now() - (1826 * 24 * 60 * 60 * 1000));
      const holdStatus = checkAmlLegalHold(oldActivity);

      expect(holdStatus.onHold).toBe(false);
    });
  });

  describe('Express Privacy API Endpoints', () => {
    it('GET /api/v1/privacy/policy returns privacy policy and retention info', async () => {
      const res = await request(app).get('/api/v1/privacy/policy');
      expect(res.status).toBe(200);
      expect(res.body.policy_version).toBe('1.0.0');
      expect(res.body.data_subject_rights).toBeDefined();
      expect(res.body.retention_schedule).toBeDefined();
    });

    it('POST /api/v1/privacy/consent records user consent', async () => {
      const res = await request(app).post('/api/v1/privacy/consent').send({
        user_id: 'usr-test-1',
        consent_type: 'privacy_policy',
        policy_version: '1.0.0',
        agreed: true,
      });

      expect(res.status).toBe(201);
      expect(res.body.consent.user_id).toBe('usr-test-1');
      expect(res.body.consent.ip_address).toBe('[REDACTED_IP]');
    });

    it('POST /api/v1/privacy/subject-access exports user personal data', async () => {
      const res = await request(app).post('/api/v1/privacy/subject-access').send({
        user_id: 'usr-test-1',
      });

      expect(res.status).toBe(200);
      expect(res.body.user_id).toBe('usr-test-1');
      expect(res.body.profile.full_name).toBeDefined();
      expect(res.body.profile.full_name).toBe('Jane Doe'); // Decrypted for data subject export
    });

    it('PUT /api/v1/privacy/rectify updates user PII with encryption', async () => {
      const res = await request(app).put('/api/v1/privacy/rectify').send({
        user_id: 'usr-test-1',
        full_name: 'Jane Smith',
        email: 'jane.smith@example.com',
      });

      expect(res.status).toBe(200);
      expect(res.body.updated_fields).toContain('full_name');
    });

    it('POST /api/v1/privacy/erasure applies legal hold carve-out for AML records', async () => {
      const res = await request(app).post('/api/v1/privacy/erasure').send({
        user_id: 'usr-test-1',
        has_financial_transactions: true,
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('legal_hold');
      expect(res.body.legal_hold_carveout).toBe(true);
      expect(res.body.erased_categories).toContain('marketing_consents');
      expect(res.body.retained_categories_under_legal_hold).toContain('transaction_audit_logs');
    });
  });
});
