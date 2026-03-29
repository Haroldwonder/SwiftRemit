import { describe, it, expect } from 'vitest';
import { sanitizeInput } from '../sanitizer';

describe('sanitizer', () => {
  describe('sanitizeInput', () => {
    it('should return empty string for null input', () => {
      expect(sanitizeInput(null as any)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(sanitizeInput(undefined as any)).toBe('');
    });

    it('should return empty string for non-string input', () => {
      expect(sanitizeInput(123 as any)).toBe('');
      expect(sanitizeInput({} as any)).toBe('');
    });

    it('should remove script tags', () => {
      const result = sanitizeInput('<script>alert("xss")</script>Test');
      expect(result).not.toContain('<script>');
      expect(result).toContain('Test');
    });

    it('should remove iframe tags', () => {
      const result = sanitizeInput('<iframe src="evil">Test');
      expect(result).not.toContain('<iframe>');
      expect(result).toContain('Test');
    });

    it('should encode HTML entities in input', () => {
      const result = sanitizeInput('<div onerror="alert(1)">Test</div>');
      expect(result).not.toContain('onerror');
      expect(result).toContain('<');
      expect(result).toContain('>');
    });

    it('should remove javascript: URLs', () => {
      const result = sanitizeInput('Click <a href="javascript:alert(1)">here</a>');
      expect(result).not.toContain('javascript:');
    });

    it('should remove event handlers', () => {
      const result = sanitizeInput('<img onerror="alert(1)" src="test.png">');
      expect(result).not.toContain('onerror');
    });

    it('should preserve safe content', () => {
      const result = sanitizeInput('This is a safe message');
      expect(result).toBe('This is a safe message');
    });

    it('should preserve punctuation and numbers', () => {
      const result = sanitizeInput('Price: $50.00 (USD) - Valid!');
      expect(result).toBe('Price: $50.00 (USD) - Valid!');
    });

    it('should trim whitespace', () => {
      const result = sanitizeInput('  test  ');
      expect(result).toBe('test');
    });

    it('should handle empty string', () => {
      expect(sanitizeInput('')).toBe('');
    });
  });
});