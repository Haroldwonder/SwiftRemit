/**
 * Input Sanitizer Module
 * 
 * Provides XSS protection by sanitizing user input that may be rendered as HTML.
 * Strips HTML tags and encodes special characters.
 */

/// HTML entities that need encoding
const HTML_ENTITIES: Record<string, string> = {
  '&': '&',
  '<': '<',
  '>': '>',
  '"': '"',
  "'": '&#x27;',
  '/': '&#x2F;',
};

/**
 * Sanitize a string to prevent XSS attacks
 * 
 * This function:
 * 1. Strips all HTML tags
 * 2. Encodes HTML special characters
 * 
 * @param input - The raw user input
 * @returns Sanitized string safe for storage/display
 */
export function sanitizeInput(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let sanitized = input;

  // Step 1: Strip HTML tags using regex
  // Removes <...> patterns including content between them
  sanitized = sanitized.replace(/<[^>]*>/g, '');
  
  // Remove script tag patterns (case insensitive)
  sanitized = sanitized.replace(/script/gi, '');
  sanitized = sanitized.replace(/on\w+=/gi, ''); // Remove event handlers

  // Step 2: Encode HTML special characters
  for (const [char, entity] of Object.entries(HTML_ENTITIES)) {
    sanitized = sanitized.split(char).join(entity);
  }

  // Step 3: Trim whitespace and collapse
  sanitized = sanitized.trim();
  
  // Remove multiple whitespaces
  sanitized = sanitized.replace(/\s+/g, ' ');

  return sanitized;
}

/**
 * Check if input contains potential XSS threats
 * 
 * @param input - Input to check
 * @returns True if suspicious content detected
 */
export function containsXss(input: string): boolean {
  if (!input) return false;
  
  const lower = input.toLowerCase();
  
  // Check for common XSS patterns
  const patterns = [
    '<script',
    'javascript:',
    'onerror=',
    'onclick=',
    'onload=',
    '<iframe',
    'eval(',
    'expression(',
  ];
  
  return patterns.some(p => lower.includes(p));
}

/**
 * Test if sanitization neutralizes XSS payloads
 * 
 * Test cases to verify:
 */
export const XSS_TEST_CASES = {
  // Should be stripped
  basicHtmlTag: '<b>bold</b>',
  scriptTag: '<script>alert(1)</script>',
  imgTag: '<img src=x onerror=alert(1)>',
  
  // Should be encoded
  angleBrackets: '<script>alert(1)</script>',
  quotes: '"test"',
  apostrophe: "'test'",
  
  // Should remain unchanged (already safe)
  plainText: 'This is a plain text report',
  specialChars: 'Test & valid <report>',
};

// Export for tests
export default {
  sanitizeInput,
  containsXss,
  XSS_TEST_CASES,
};