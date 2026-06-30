/**
 * Input Sanitizer Module
 *
 * Provides XSS protection by sanitizing user input using the `xss` library,
 * which handles HTML entity encoding, Unicode escapes, and obfuscation that
 * bypass regex-based detection.
 */

import xss from 'xss';

/**
 * Sanitize a string to prevent XSS attacks.
 *
 * @param input - The raw user input
 * @returns Sanitized string safe for storage/display
 */
export function sanitizeInput(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }
  return xss(input.trim());
}

/**
 * Check if input contains potential XSS threats.
 *
 * @param input - Input to check
 * @returns True if the xss library would modify the string (i.e. suspicious content detected)
 */
export function containsXss(input: string): boolean {
  if (!input) return false;
  return xss(input) !== input;
}

export default { sanitizeInput, containsXss };
