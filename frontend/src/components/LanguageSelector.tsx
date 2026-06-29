import React from 'react';
import { useTranslation } from 'react-i18next';
import './LanguageSelector.css';

const LANGUAGES = [
  { code: 'en', key: 'language.en' },
  { code: 'es', key: 'language.es' },
  { code: 'fr', key: 'language.fr' },
  { code: 'pt', key: 'language.pt' },
] as const;

export const LanguageSelector: React.FC = () => {
  const { t, i18n } = useTranslation();

  return (
    <label className="lang-selector" aria-label={t('language.selector')}>
      <span className="lang-selector-icon" aria-hidden="true">🌐</span>
      <select
        value={i18n.language}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
      >
        {LANGUAGES.map(({ code, key }) => (
          <option key={code} value={code}>
            {t(key)}
          </option>
        ))}
      </select>
    </label>
  );
};
