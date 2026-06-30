/**
 * CI check: every supported locale must define every template key.
 * Exit 1 if any key is missing.
 */

import { SUPPORTED_LOCALES, TEMPLATE_KEYS } from '../src/notification-templates';
import en from '../src/notification-templates/en';
import es from '../src/notification-templates/es';
import fr from '../src/notification-templates/fr';
import pt from '../src/notification-templates/pt';
import { LocaleTemplates, SupportedLocale } from '../src/notification-templates/types';

const localeMap: Record<SupportedLocale, LocaleTemplates> = { en, es, fr, pt };

let failed = false;

for (const locale of SUPPORTED_LOCALES) {
  for (const key of TEMPLATE_KEYS) {
    if (!localeMap[locale][key]) {
      console.error(`[check-notification-templates] MISSING: locale="${locale}" key="${key}"`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log('[check-notification-templates] All locales have all template keys.');
}
