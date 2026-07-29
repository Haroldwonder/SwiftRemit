/**
 * Notification template helpers.
 *
 * Fallback chain (SR-035)
 * ───────────────────────
 * When a locale tag is provided, templates are resolved in this order:
 *
 *   1. Exact match           — e.g. 'fr' finds TEMPLATES['fr']
 *   2. Base language         — e.g. 'fr-CA' strips the region tag → 'fr'
 *   3. English default       — 'en' is always available and never falls back further
 *
 * This ensures a user whose `preferred_language` is 'pt-BR' still receives
 * Portuguese copy, and any locale we haven't added yet gracefully falls back
 * to English rather than rendering `undefined`.
 */

import en from './en';
import es from './es';
import fr from './fr';
import pt from './pt';
import { LocaleTemplates, SupportedLocale, TemplateKey, TemplateParams } from './types';

export { SupportedLocale, TemplateKey, TemplateParams };

const TEMPLATES: Record<SupportedLocale, LocaleTemplates> = { en, es, fr, pt };

export const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'es', 'fr', 'pt'];
export const TEMPLATE_KEYS: TemplateKey[] = [
  'remittance_created',
  'remittance_completed',
  'remittance_failed',
  'kyc_approved',
  'kyc_expired',
];

/**
 * Resolve a locale string to a supported locale following the fallback chain:
 *   exact match → base language → 'en'
 *
 * @example
 *   resolveLocale('fr-CA') // → 'fr'
 *   resolveLocale('zh')    // → 'en'  (not supported, falls back)
 *   resolveLocale(null)    // → 'en'
 */
export function resolveLocale(locale: string | undefined | null): SupportedLocale {
  if (!locale) return 'en';

  // 1. Exact match (e.g. 'fr', 'pt')
  if (TEMPLATES[locale as SupportedLocale]) {
    return locale as SupportedLocale;
  }

  // 2. Base language (e.g. 'fr-CA' → 'fr', 'pt-BR' → 'pt')
  const base = locale.split('-')[0].toLowerCase();
  if (TEMPLATES[base as SupportedLocale]) {
    return base as SupportedLocale;
  }

  // 3. Default
  return 'en';
}

/**
 * Returns the message template for the given locale and key.
 *
 * Applies the full fallback chain: locale → base language → 'en'.
 * Never returns undefined — the English template is always the final fallback.
 */
export function getTemplate(
  locale: string | undefined | null,
  key: TemplateKey,
): LocaleTemplates[TemplateKey] {
  const resolved = resolveLocale(locale);
  return TEMPLATES[resolved][key] ?? TEMPLATES['en'][key];
}

/**
 * Build a localised notification message.
 *
 * @param locale – BCP-47 tag from `notification_preferences.preferred_language`
 *                 (e.g. 'fr', 'pt', 'fr-CA').  Null/undefined → English.
 * @param key    – template key (must be a member of TemplateKey)
 * @param params – interpolation values
 */
export function buildLocalizedMessage(
  locale: string | undefined | null,
  key: TemplateKey,
  params: TemplateParams,
): { subject: string; text: string } {
  const template = getTemplate(locale, key);
  return { subject: template.subject, text: template.text(params) };
}
