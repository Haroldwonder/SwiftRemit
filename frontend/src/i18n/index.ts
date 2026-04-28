import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import pt from './locales/pt.json';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
    pt: { translation: pt },
  },
  // Detect browser language, fall back to English
  lng: navigator.language.split('-')[0],
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
