import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '../ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.clearAllMocks();
  });

  it('should persist theme preference to localStorage', () => {
    const { rerender } = render(<ThemeToggle />);
    const button = screen.getByRole('button');

    fireEvent.click(button);

    expect(localStorage.getItem('theme')).toBe('dark');

    rerender(<ThemeToggle />);

    // Should restore from localStorage
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('should respect prefers-color-scheme on first load', () => {
    const mockMediaQuery = {
      matches: true,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };

    vi.spyOn(window, 'matchMedia').mockReturnValue(mockMediaQuery as any);

    render(<ThemeToggle />);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('should apply theme to document on mount', () => {
    localStorage.setItem('theme', 'dark');

    render(<ThemeToggle />);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('should toggle between light and dark', () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button');

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    fireEvent.click(button);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    fireEvent.click(button);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('should prevent FOUC with early theme application', () => {
    localStorage.setItem('theme', 'dark');

    const { container } = render(<ThemeToggle />);

    // Check that theme attribute is set before the component fully renders
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
