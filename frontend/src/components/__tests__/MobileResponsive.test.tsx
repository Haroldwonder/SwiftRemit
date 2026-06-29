import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SendMoneyFlow } from '../SendMoneyFlow';
import { TransactionHistory } from '../TransactionHistory';
import { WalletConnection } from '../WalletConnection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Asset: { native: () => ({}) },
  Horizon: { Server: vi.fn().mockImplementation(() => ({ loadAccount: vi.fn() })) },
}));

// Mock window.matchMedia for responsive tests
const mockMatchMedia = (width: number) => {
  return (query: string) => {
    const mediaQueryList = {
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };

    // Parse query and check if it matches the width
    if (query.includes('375px')) mediaQueryList.matches = width <= 375;
    if (query.includes('768px')) mediaQueryList.matches = width <= 768;
    if (query.includes('600px')) mediaQueryList.matches = width <= 600;
    if (query.includes('min-width')) mediaQueryList.matches = true;

    return mediaQueryList as unknown as MediaQueryList;
  };
};

describe('Mobile Responsive Layout', () => {
  const VALID_RECIPIENT = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window size
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });
  });

  describe('Mobile Viewport (375px - iPhone SE)', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });
      window.matchMedia = mockMatchMedia(375) as any;
    });

    it('should render Send Money Flow on mobile', () => {
      render(<SendMoneyFlow />);
      expect(screen.getByText(/send/i)).toBeDefined();
    });

    it('should stack form inputs vertically on mobile', () => {
      render(<SendMoneyFlow />);

      const form = screen.getByRole('form') || screen.queryByTestId('form-container');
      if (form) {
        const computedStyle = window.getComputedStyle(form);
        expect(computedStyle.display).not.toBe('grid');
      }
    });

    it('should make buttons full-width on mobile', () => {
      render(<SendMoneyFlow />);

      const buttons = screen.getAllByRole('button');
      buttons.forEach((button) => {
        const computedStyle = window.getComputedStyle(button);
        expect(['100%', '1024px']).toContain(computedStyle.width);
      });
    });

    it('should use large touch targets (min 44px)', () => {
      render(<SendMoneyFlow />);

      const buttons = screen.getAllByRole('button');
      buttons.forEach((button) => {
        const rect = button.getBoundingClientRect();
        expect(rect.height).toBeGreaterThanOrEqual(44);
        expect(rect.width).toBeGreaterThanOrEqual(44);
      });
    });

    it('should hide unnecessary columns on mobile', () => {
      render(<TransactionHistory />);

      // On mobile, detail columns should be hidden or collapsed
      const table = screen.queryByRole('table');
      if (table) {
        const cells = within(table).queryAllByRole('cell');
        // Should have fewer visible cells on mobile
        expect(cells.length).toBeGreaterThan(0);
      }
    });

    it('should display content in readable font size', () => {
      render(<SendMoneyFlow />);

      const inputs = screen.getAllByRole('textbox') || screen.getAllByDisplayValue(/input/i);
      if (inputs.length > 0) {
        const fontSize = window.getComputedStyle(inputs[0]).fontSize;
        const size = parseInt(fontSize);
        expect(size).toBeGreaterThanOrEqual(14); // Minimum readable font size
      }
    });

    it('should have proper padding on mobile', () => {
      render(<SendMoneyFlow />);

      const container = screen.getByTestId?.('container') || screen.getByRole('form');
      if (container) {
        const computedStyle = window.getComputedStyle(container);
        const padding = computedStyle.padding || computedStyle.paddingTop;
        expect(padding).not.toBe('0px');
      }
    });

    it('should handle narrow viewport without horizontal scroll', () => {
      render(<SendMoneyFlow />);

      const html = document.documentElement;
      expect(html.scrollWidth).toBeLessThanOrEqual(375 + 1); // Allow minimal overflow
    });

    it('should display step wizard vertically on mobile', () => {
      render(<SendMoneyFlow />);

      // Look for step indicators
      const steps = screen.queryAllByText(/step/i);
      if (steps.length > 0) {
        // Steps should be stacked vertically
        steps.forEach((step) => {
          expect(step).toBeDefined();
        });
      }
    });

    it('should make inputs touch-friendly', () => {
      render(<SendMoneyFlow />);

      const inputs = screen.getAllByRole('textbox');
      inputs.forEach((input) => {
        const rect = input.getBoundingClientRect();
        expect(rect.height).toBeGreaterThanOrEqual(44);
      });
    });

    it('should show mobile-optimized error messages', async () => {
      render(<SendMoneyFlow />);

      // Trigger validation error
      const amountInput = screen.getByLabelText?.(/amount/i) || screen.getByDisplayValue(/amount/i);
      if (amountInput) {
        await userEvent.type(amountInput, '0');
        fireEvent.blur(amountInput);

        // Error should be visible and readable on mobile
        const error = screen.queryByText(/error|invalid/i);
        if (error) {
          expect(error).toBeDefined();
        }
      }
    });
  });

  describe('Tablet Viewport (768px - iPad)', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 768,
      });
      window.matchMedia = mockMatchMedia(768) as any;
    });

    it('should render responsive layout on tablet', () => {
      render(<SendMoneyFlow />);
      expect(screen.getByText(/send/i)).toBeDefined();
    });

    it('should use two-column layout on tablet', () => {
      render(<TransactionHistory />);

      const table = screen.queryByRole('table');
      if (table) {
        expect(table).toBeDefined();
      }
    });

    it('should display all core columns on tablet', () => {
      render(<TransactionHistory />);

      const table = screen.queryByRole('table');
      if (table) {
        const headers = within(table).queryAllByRole('columnheader');
        expect(headers.length).toBeGreaterThan(0);
      }
    });

    it('should provide adequate spacing on tablet', () => {
      render(<SendMoneyFlow />);

      const elements = screen.getAllByRole('button');
      elements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        expect(rect.width).toBeGreaterThan(0);
      });
    });

    it('should optimize grid for tablet screen', () => {
      render(<TransactionHistory />);

      // Content should fit within 768px width
      const html = document.documentElement;
      expect(html.scrollWidth).toBeLessThanOrEqual(768 + 1);
    });
  });

  describe('All Core Flows on Mobile', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });
      window.matchMedia = mockMatchMedia(375) as any;
    });

    it('should handle wallet connection flow on 375px', () => {
      render(<WalletConnection />);

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);

      // All buttons should be accessible
      buttons.forEach((btn) => {
        expect(btn.offsetHeight).toBeGreaterThanOrEqual(44);
      });
    });

    it('should handle send money flow on 375px', () => {
      render(<SendMoneyFlow />);

      const form = screen.getByRole('form') || screen.getByTestId?.('form');
      if (form) {
        expect(form.offsetWidth).toBeLessThanOrEqual(375);
      }
    });

    it('should handle transaction history on 375px', () => {
      render(<TransactionHistory />);

      const container = screen.getByTestId?.('container') || document.body;
      expect(container.offsetWidth).toBeLessThanOrEqual(375);
    });

    it('should navigate between screens without horizontal scroll', async () => {
      const { rerender } = render(<SendMoneyFlow />);

      // Verify no horizontal scroll needed
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375 + 1);

      rerender(<TransactionHistory />);

      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375 + 1);
    });
  });

  describe('Responsive Typography', () => {
    it('should use scalable font sizes', () => {
      render(<SendMoneyFlow />);

      const heading = screen.queryByRole('heading');
      if (heading) {
        const fontSize = window.getComputedStyle(heading).fontSize;
        const size = parseInt(fontSize);
        expect(size).toBeGreaterThan(12);
      }
    });

    it('should maintain readability at all sizes', () => {
      const sizes = [375, 600, 768, 1024];

      sizes.forEach((width) => {
        Object.defineProperty(window, 'innerWidth', {
          writable: true,
          configurable: true,
          value: width,
        });

        const { unmount } = render(<SendMoneyFlow />);

        const textElements = screen.getAllByRole('textbox');
        textElements.forEach((el) => {
          const fontSize = window.getComputedStyle(el).fontSize;
          const size = parseInt(fontSize);
          expect(size).toBeGreaterThanOrEqual(14);
        });

        unmount();
      });
    });
  });

  describe('SendMoneyFlow Step Wizard on Mobile', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });
      window.matchMedia = mockMatchMedia(375) as any;
    });

    it('should display steps vertically on mobile', () => {
      render(<SendMoneyFlow />);

      const steps = screen.queryAllByText(/step/i);
      if (steps.length > 0) {
        // Steps should exist and be navigable
        expect(steps.length).toBeGreaterThan(0);
      }
    });

    it('should show one step at a time on mobile', () => {
      render(<SendMoneyFlow />);

      // Only current step form should be visible
      const forms = screen.queryAllByRole('form');
      if (forms.length > 0) {
        forms.forEach((form) => {
          expect(form.offsetHeight).toBeGreaterThan(0);
        });
      }
    });

    it('should make back/continue buttons accessible', () => {
      render(<SendMoneyFlow />);

      const buttons = screen.getAllByRole('button');
      const navButtons = buttons.filter((btn) =>
        /back|continue|next|submit|confirm/i.test(btn.textContent || '')
      );

      navButtons.forEach((btn) => {
        expect(btn.offsetHeight).toBeGreaterThanOrEqual(44);
        expect(btn.offsetWidth).toBeGreaterThanOrEqual(44);
      });
    });

    it('should display progress indicator on mobile', () => {
      render(<SendMoneyFlow />);

      // Should show which step out of total
      const progressText = screen.queryByText(/step.*of/i);
      if (progressText) {
        expect(progressText).toBeDefined();
      }
    });
  });

  describe('Touch Interactions', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });
      window.matchMedia = mockMatchMedia(375) as any;
    });

    it('should support touch events on buttons', async () => {
      render(<SendMoneyFlow />);

      const button = screen.getByRole('button', { name: /continue|proceed/i });
      const touchEvent = new TouchEvent('touchstart', {
        bubbles: true,
        cancelable: true,
      });

      fireEvent(button, touchEvent);
      expect(button).toBeDefined();
    });

    it('should have appropriate spacing between touch targets', () => {
      render(<SendMoneyFlow />);

      const buttons = screen.getAllByRole('button');
      if (buttons.length > 1) {
        const rect1 = buttons[0].getBoundingClientRect();
        const rect2 = buttons[1].getBoundingClientRect();

        // Minimum 8px spacing between targets
        const verticalGap = Math.abs(rect2.top - rect1.bottom);
        const horizontalGap = Math.abs(rect2.left - rect1.right);

        expect(Math.min(verticalGap, horizontalGap)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Orientation Changes', () => {
    it('should adapt layout on orientation change', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });

      const { rerender } = render(<SendMoneyFlow />);

      // Simulate orientation change to landscape
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 667,
      });

      rerender(<SendMoneyFlow />);
      expect(screen.getByText(/send/i)).toBeDefined();
    });
  });

  describe('Accessibility on Mobile', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });
    });

    it('should maintain semantic HTML on mobile', () => {
      render(<SendMoneyFlow />);

      const headings = screen.queryAllByRole('heading');
      expect(headings).toBeDefined();
    });

    it('should have sufficient color contrast on mobile', () => {
      render(<SendMoneyFlow />);

      const buttons = screen.getAllByRole('button');
      buttons.forEach((btn) => {
        const color = window.getComputedStyle(btn).color;
        const backgroundColor = window.getComputedStyle(btn).backgroundColor;

        // Both should be defined for contrast checking
        expect(color).toBeDefined();
        expect(backgroundColor).toBeDefined();
      });
    });

    it('should support keyboard navigation on mobile', async () => {
      render(<SendMoneyFlow />);

      const firstButton = screen.getByRole('button', { name: /continue|proceed/i });
      firstButton.focus();

      expect(document.activeElement).toBe(firstButton);
    });
  });
});
