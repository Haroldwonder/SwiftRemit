/**
 * SR-035 — Notification template i18n parity tests
 *
 * Covers:
 *   - Key-parity: all four locales export the same key set (fails when one locale
 *     adds a key the others don't have).
 *   - Fallback chain: locale → base language → 'en'.
 *   - preferred_language honoured: a user with preferred_language = 'fr' receives
 *     French copy, not English.
 *   - TypeScript structural check is exercised at import time (compile error if
 *     a locale file is missing a required key).
 */

import { describe, it, expect } from 'vitest';
import en from '../notification-templates/en';
import es from '../notification-templates/es';
import fr from '../notification-templates/fr';
import pt from '../notification-templates/pt';
import {
  TEMPLATE_KEYS,
  SUPPORTED_LOCALES,
  getTemplate,
  buildLocalizedMessage,
  resolveLocale,
} from '../notification-templates';
import type { LocaleTemplates, TemplateKey } from '../notification-templates/types';

// ─── 1. Key-parity test ───────────────────────────────────────────────────────

describe('Locale key parity (SR-035)', () => {
  const localeMap: Record<string, LocaleTemplates> = { en, es, fr, pt };

  it('all four locales export exactly the same keys as TEMPLATE_KEYS', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const file = localeMap[locale];
      const fileKeys = Object.keys(file).sort();
      const expectedKeys = [...TEMPLATE_KEYS].sort();

      expect(fileKeys, `${locale} locale key mismatch`).toEqual(expectedKeys);
    }
  });

  it('every key in en is present in es, fr, and pt', () => {
    const enKeys = Object.keys(en) as TemplateKey[];
    for (const key of enKeys) {
      expect(es, `key '${key}' missing from es`).toHaveProperty(key);
      expect(fr, `key '${key}' missing from fr`).toHaveProperty(key);
      expect(pt, `key '${key}' missing from pt`).toHaveProperty(key);
    }
  });

  it('no locale has extra keys not in TEMPLATE_KEYS', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const file = localeMap[locale];
      for (const key of Object.keys(file)) {
        expect(TEMPLATE_KEYS, `locale '${locale}' has unexpected key '${key}'`).toContain(key);
      }
    }
  });

  it('every template has a non-empty subject and a callable text function', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const file = localeMap[locale];
      for (const key of TEMPLATE_KEYS) {
        const tpl = file[key];
        expect(typeof tpl.subject, `${locale}.${key}.subject`).toBe('string');
        expect(tpl.subject.length, `${locale}.${key}.subject is empty`).toBeGreaterThan(0);
        expect(typeof tpl.text, `${locale}.${key}.text`).toBe('function');
      }
    }
  });
});

// ─── 2. No English strings leaked into other locales ─────────────────────────

describe('Translation completeness (SR-035)', () => {
  for (const locale of (['es', 'fr', 'pt'] as const)) {
    const file = localeMap(locale);

    it(`${locale}: no subject is identical to the English subject`, () => {
      for (const key of TEMPLATE_KEYS) {
        expect(file[key].subject, `${locale}.${key} subject is untranslated English`)
          .not.toBe(en[key].subject);
      }
    });

    it(`${locale}: no text output is identical to the English text output`, () => {
      for (const key of TEMPLATE_KEYS) {
        const params = { remittanceId: 'R1', amount: 10, currency: 'USD' };
        const localeText = file[key].text(params);
        const enText = en[key].text(params);
        expect(localeText, `${locale}.${key} text is untranslated English`)
          .not.toBe(enText);
      }
    });
  }

  function localeMap(l: 'es' | 'fr' | 'pt'): LocaleTemplates {
    return { es, fr, pt }[l];
  }
});

// ─── 3. Fallback chain ────────────────────────────────────────────────────────

describe('resolveLocale fallback chain (SR-035)', () => {
  it('returns the exact locale for supported locales', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('es')).toBe('es');
    expect(resolveLocale('fr')).toBe('fr');
    expect(resolveLocale('pt')).toBe('pt');
  });

  it('resolves base language for region-tagged locales', () => {
    expect(resolveLocale('fr-CA')).toBe('fr');
    expect(resolveLocale('pt-BR')).toBe('pt');
    expect(resolveLocale('es-419')).toBe('es');
  });

  it('falls back to en for completely unsupported locales', () => {
    expect(resolveLocale('zh')).toBe('en');
    expect(resolveLocale('ar')).toBe('en');
    expect(resolveLocale('de-DE')).toBe('en');
  });

  it('falls back to en for null / undefined / empty', () => {
    expect(resolveLocale(null)).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
    expect(resolveLocale('')).toBe('en');
  });
});

describe('getTemplate fallback chain (SR-035)', () => {
  it('returns French template for fr locale', () => {
    const tpl = getTemplate('fr', 'remittance_completed');
    expect(tpl.subject).toBe(fr.remittance_completed.subject);
  });

  it('returns French template for fr-CA (base-language fallback)', () => {
    const tpl = getTemplate('fr-CA', 'remittance_completed');
    expect(tpl.subject).toBe(fr.remittance_completed.subject);
  });

  it('returns English template for unsupported locale', () => {
    const tpl = getTemplate('zh', 'remittance_completed');
    expect(tpl.subject).toBe(en.remittance_completed.subject);
  });

  it('returns English template for null locale', () => {
    const tpl = getTemplate(null, 'kyc_approved');
    expect(tpl.subject).toBe(en.kyc_approved.subject);
  });
});

// ─── 4. preferred_language honoured ──────────────────────────────────────────

describe('buildLocalizedMessage honours preferred_language (SR-035)', () => {
  const params = { remittanceId: 'rem-42', amount: 250, currency: 'USDC' };

  it('renders French copy for preferred_language = fr', () => {
    const { subject, text } = buildLocalizedMessage('fr', 'remittance_created', params);
    expect(subject).toBe(fr.remittance_created.subject);
    expect(text).toBe(fr.remittance_created.text(params));
  });

  it('renders Portuguese copy for preferred_language = pt', () => {
    const { subject, text } = buildLocalizedMessage('pt', 'remittance_completed', params);
    expect(subject).toBe(pt.remittance_completed.subject);
    expect(text).toBe(pt.remittance_completed.text(params));
  });

  it('renders Spanish copy for preferred_language = es', () => {
    const { subject, text } = buildLocalizedMessage('es', 'remittance_failed', params);
    expect(subject).toBe(es.remittance_failed.subject);
    expect(text).toBe(es.remittance_failed.text(params));
  });

  it('renders English copy for preferred_language = en', () => {
    const { subject, text } = buildLocalizedMessage('en', 'kyc_expired', {});
    expect(subject).toBe(en.kyc_expired.subject);
    expect(text).toBe(en.kyc_expired.text({}));
  });

  it('renders Portuguese copy for regional tag pt-BR (base-language fallback)', () => {
    const { subject } = buildLocalizedMessage('pt-BR', 'remittance_created', params);
    expect(subject).toBe(pt.remittance_created.subject);
  });

  it('falls back to English for unknown locale', () => {
    const { subject } = buildLocalizedMessage('zh-TW', 'kyc_approved', {});
    expect(subject).toBe(en.kyc_approved.subject);
  });

  it('each locale produces distinct output for remittance_created', () => {
    const subjects = SUPPORTED_LOCALES.map(l =>
      buildLocalizedMessage(l, 'remittance_created', params).subject
    );
    const unique = new Set(subjects);
    expect(unique.size).toBe(SUPPORTED_LOCALES.length);
  });
});
