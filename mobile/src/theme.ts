/** Shared, system-driven light/dark palette for the mobile app. */
import { useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

export type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  secondaryText: string;
  border: string;
  primary: string;
  onPrimary: string;
  offline: string;
  reconnecting: string;
};

export const lightColors: ThemeColors = {
  background: '#F9FAFB',
  surface: '#FFFFFF',
  text: '#111827',
  secondaryText: '#6B7280',
  border: '#E5E7EB',
  primary: '#1A56DB',
  onPrimary: '#FFFFFF',
  offline: '#B91C1C',
  reconnecting: '#92400E',
};

export const darkColors: ThemeColors = {
  background: '#0B1220',
  surface: '#172033',
  text: '#F8FAFC',
  secondaryText: '#CBD5E1',
  border: '#334155',
  primary: '#3B82F6',
  onPrimary: '#FFFFFF',
  offline: '#B91C1C',
  reconnecting: '#92400E',
};

/** Uses the OS preference, including live changes while the app is open. */
export function useAppTheme(): { colors: ThemeColors; isDark: boolean } {
  const isDark = useColorScheme() === 'dark';
  return { colors: isDark ? darkColors : lightColors, isDark };
}

// Translation of the existing light styles. Brand/action and error text on
// colored buttons remain legible; only palette tokens are remapped.
const darkPalette: Record<string, string> = {
  '#f9fafb': darkColors.background,
  '#eff6ff': '#172B4E',
  '#fecaca': '#7F1D1D',
  '#1e3a5f': '#BFDBFE',
  '#d1fae5': '#064E3B',
  '#065f46': '#A7F3D0',
  '#fef3c7': '#78350F',
  '#fee2e2': '#7F1D1D',
  '#7f1d1d': '#FECACA',
  '#ffffff': darkColors.surface,
  '#f3f4f6': '#1E293B',
  '#e5e7eb': darkColors.border,
  '#d1d5db': '#475569',
  '#111827': darkColors.text,
  '#374151': '#CBD5E1',
  '#6b7280': '#A8B4C7',
  '#9ca3af': '#94A3B8',
  '#1a56db': darkColors.primary,
  '#10b981': '#34D399',
  '#ef4444': '#F87171',
  '#f59e0b': '#FBBF24',
  '#fff7ed': '#3B2A18',
  '#fef2f2': '#3B1D26',
  '#92400e': '#FBBF24',
  '#78350f': '#FED7AA',
  '#991b1b': '#FCA5A5',
};

const colorProperties = [
  'backgroundColor', 'color', 'borderColor', 'borderTopColor',
  'borderBottomColor', 'borderLeftColor', 'borderRightColor',
  'textDecorationColor',
] as const;

/** Preserve all spacing/layout values while applying theme colors to styles. */
export function useThemedStyles<T extends Record<string, any>>(baseStyles: T): T {
  const { isDark } = useAppTheme();
  return useMemo(() => {
    if (!isDark) return baseStyles;
    const result = {} as T;
    for (const key of Object.keys(baseStyles) as Array<keyof T>) {
      const original = StyleSheet.flatten(baseStyles[key]) as Record<string, any> | undefined;
      const style = { ...original };
      for (const property of colorProperties) {
        const value = style[property];
        if (typeof value !== 'string') continue;
        const normalized = value.toLowerCase() === '#fff' ? '#ffffff' : value.toLowerCase();
        // White text on colored buttons should stay white in dark mode.
        if (property === 'color' && normalized === '#ffffff') continue;
        if (normalized in darkPalette) style[property] = darkPalette[normalized];
      }
      result[key] = style as T[typeof key];
    }
    return result;
  }, [baseStyles, isDark]);
}
