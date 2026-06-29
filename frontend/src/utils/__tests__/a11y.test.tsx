import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { SkipToContentLink, handleKeyboardNavigation, useAriaLive } from '../a11y';

expect.extend(toHaveNoViolations);

describe('a11y utilities', () => {
  describe('SkipToContentLink', () => {
    it('should render skip link', () => {
      render(<SkipToContentLink />);
      expect(screen.getByText('Skip to main content')).toBeInTheDocument();
    });

    it('should focus main content on click', () => {
      const { container } = render(
        <>
          <SkipToContentLink />
          <main id="main-content" tabIndex={-1}>
            Main content
          </main>
        </>
      );

      const skipLink = screen.getByText('Skip to main content');
      fireEvent.click(skipLink);

      expect(document.getElementById('main-content')).toHaveFocus();
    });

    it('should have no accessibility violations', async () => {
      const { container } = render(<SkipToContentLink />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('handleKeyboardNavigation', () => {
    it('should handle arrow down', () => {
      const event = { key: 'ArrowDown', preventDefault: vi.fn() } as any;
      const result = handleKeyboardNavigation(event, 5, 0, vi.fn());
      expect(result).toBe(1);
    });

    it('should handle arrow up', () => {
      const event = { key: 'ArrowUp', preventDefault: vi.fn() } as any;
      const result = handleKeyboardNavigation(event, 5, 2, vi.fn());
      expect(result).toBe(1);
    });

    it('should handle Home key', () => {
      const event = { key: 'Home', preventDefault: vi.fn() } as any;
      const result = handleKeyboardNavigation(event, 5, 4, vi.fn());
      expect(result).toBe(0);
    });

    it('should handle End key', () => {
      const event = { key: 'End', preventDefault: vi.fn() } as any;
      const result = handleKeyboardNavigation(event, 5, 0, vi.fn());
      expect(result).toBe(4);
    });

    it('should call onSelect on Enter', () => {
      const onSelect = vi.fn();
      const event = { key: 'Enter', preventDefault: vi.fn() } as any;
      handleKeyboardNavigation(event, 5, 2, onSelect);
      expect(onSelect).toHaveBeenCalledWith(2);
    });
  });

  describe('useAriaLive', () => {
    it('should provide region props', () => {
      const Component = () => {
        const { regionProps, announce } = useAriaLive('Test message');
        return (
          <div {...regionProps}>
            <button onClick={announce}>Announce</button>
          </div>
        );
      };

      const { container } = render(<Component />);
      const region = container.querySelector('[role="status"]');

      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveAttribute('aria-atomic', 'true');
    });
  });
});
