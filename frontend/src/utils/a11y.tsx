import React from 'react';

/**
 * Skip-to-content link for keyboard navigation
 * Should be the first focusable element in the page
 */
export function SkipToContentLink(): React.ReactElement {
  return (
    <a
      href="#main-content"
      className="skip-to-content-link"
      onClick={(e) => {
        e.preventDefault();
        const mainContent = document.getElementById('main-content');
        if (mainContent) {
          mainContent.focus();
          mainContent.scrollIntoView({ behavior: 'smooth' });
        }
      }}
    >
      Skip to main content
    </a>
  );
}

/**
 * Keyboard navigation handler for dropdowns/menus
 */
export function handleKeyboardNavigation(
  event: React.KeyboardEvent,
  itemCount: number,
  currentIndex: number,
  onSelect: (index: number) => void
): number {
  const { key } = event;

  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      event.preventDefault();
      return Math.min(currentIndex + 1, itemCount - 1);
    case 'ArrowUp':
    case 'ArrowLeft':
      event.preventDefault();
      return Math.max(currentIndex - 1, 0);
    case 'Home':
      event.preventDefault();
      return 0;
    case 'End':
      event.preventDefault();
      return itemCount - 1;
    case 'Enter':
    case ' ':
      event.preventDefault();
      onSelect(currentIndex);
      return currentIndex;
    default:
      return currentIndex;
  }
}

/**
 * ARIA live region announcements
 */
export function useAriaLive(
  message: string,
  politeness: 'polite' | 'assertive' = 'polite'
): { announce: () => void; regionProps: React.AriaAttributes } {
  const announcementRef = React.useRef<HTMLDivElement>(null);

  const announce = React.useCallback(() => {
    if (announcementRef.current) {
      announcementRef.current.textContent = message;
    }
  }, [message]);

  const regionProps = {
    'aria-live': politeness,
    'aria-atomic': 'true',
    role: 'status',
    className: 'sr-only',
  } as React.AriaAttributes;

  return { announce, regionProps };
}
