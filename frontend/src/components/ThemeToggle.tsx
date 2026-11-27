import { useEffect, useState } from 'react';
import { safeStorage } from '../utils/safeStorage';

type Theme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function getStoredTheme(): Theme | null {
  const stored = safeStorage.getItem('theme');
  return stored === 'light' || stored === 'dark' ? stored : null;
}

function getSystemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme() ?? getSystemTheme());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // While no explicit preference is saved, follow OS color-scheme changes live.
  useEffect(() => {
    const mediaQuery = window.matchMedia(DARK_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      if (getStoredTheme() !== null) return;
      setTheme(event.matches ? 'dark' : 'light');
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    safeStorage.setItem('theme', next);
    setTheme(next);
  };

  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}
