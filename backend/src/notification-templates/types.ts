/**
 * Notification template type definitions.
 *
 * SR-035 / i18n parity
 * ─────────────────────
 * `LocaleTemplates` is defined as `Record<TemplateKey, MessageTemplate>`, which
 * means TypeScript raises a compile error if any locale file exports an object
 * that is missing one of the required keys or has a key that doesn't exist in
 * the union.  Add a new key here → every locale file must add it too.
 *
 * Fallback chain (runtime):  requested-locale → base-language → 'en'
 *   e.g. 'fr-CA' → 'fr' → 'en'
 * Implemented in notification-templates/index.ts :: getTemplate().
 */

export type SupportedLocale = 'en' | 'es' | 'fr' | 'pt';

/**
 * Union of every key that MUST be present in each locale file.
 * Adding a new string to this union causes TypeScript to reject any
 * `LocaleTemplates` object that does not define it.
 */
export type TemplateKey =
  | 'remittance_created'
  | 'remittance_completed'
  | 'remittance_failed'
  | 'kyc_approved'
  | 'kyc_expired';

export interface TemplateParams {
  remittanceId?: string;
  amount?: number;
  currency?: string;
}

export interface MessageTemplate {
  subject: string;
  text: (params: TemplateParams) => string;
}

/**
 * Every locale file must export an object satisfying this type.
 * Because it is `Record<TemplateKey, MessageTemplate>` (not a partial), the
 * TypeScript compiler rejects a locale that omits any key — fulfilling the
 * "missing key is a compile error" acceptance criterion.
 */
export type LocaleTemplates = Record<TemplateKey, MessageTemplate>;
