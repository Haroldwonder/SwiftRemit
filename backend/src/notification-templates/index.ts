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
 * Returns the message template for the given locale and key.
 * Falls back to English if the locale or key is missing.
 */
export function getTemplate(
  locale: string | undefined | null,
  key: TemplateKey,
): LocaleTemplates[TemplateKey] {
  const resolved = (locale && TEMPLATES[locale as SupportedLocale]) ? locale as SupportedLocale : 'en';
  return TEMPLATES[resolved][key] ?? TEMPLATES['en'][key];
}

/**
 * Build a localised notification message.
 */
export function buildLocalizedMessage(
  locale: string | undefined | null,
  key: TemplateKey,
  params: TemplateParams,
): { subject: string; text: string } {
  const template = getTemplate(locale, key);
  return { subject: template.subject, text: template.text(params) };
}
