import React from 'react';
import type { Preview, Decorator } from '@storybook/react';
import i18n from '../src/i18n/index.ts';

// ── Dark-mode decorator ──────────────────────────────────────────────────────
const withDarkMode: Decorator = (Story, context) => {
  const isDark = context.globals['theme'] === 'dark';
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    document.body.dataset.theme = isDark ? 'dark' : 'light';
    return () => {
      document.documentElement.classList.remove('dark');
      delete document.body.dataset.theme;
    };
  }, [isDark]);
  return React.createElement(Story);
};

// ── Locale decorator ─────────────────────────────────────────────────────────
const withLocale: Decorator = (Story, context) => {
  const locale = (context.globals['locale'] as string) ?? 'en';
  React.useEffect(() => {
    if (i18n.language !== locale) {
      i18n.changeLanguage(locale);
    }
  }, [locale]);
  return React.createElement(Story);
};

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Color theme',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', icon: 'sun', title: 'Light' },
          { value: 'dark', icon: 'moon', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    locale: {
      description: 'UI locale / language',
      defaultValue: 'en',
      toolbar: {
        title: 'Locale',
        icon: 'globe',
        items: [
          { value: 'en', right: '🇬🇧', title: 'English' },
          { value: 'es', right: '🇪🇸', title: 'Español' },
          { value: 'fr', right: '🇫🇷', title: 'Français' },
          { value: 'pt', right: '🇧🇷', title: 'Português' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [withDarkMode, withLocale],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      config: {
        rules: [
          // Enforce colour contrast, keyboard navigation, ARIA labels, etc.
          { id: 'color-contrast', enabled: true },
          { id: 'label', enabled: true },
          { id: 'button-name', enabled: true },
          { id: 'link-name', enabled: true },
        ],
      },
    },
  },
};

export default preview;
