"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const sanitizer_1 = require("../sanitizer");
(0, vitest_1.describe)('sanitizer', () => {
    (0, vitest_1.describe)('sanitizeInput', () => {
        (0, vitest_1.it)('should return empty string for null input', () => {
            (0, vitest_1.expect)((0, sanitizer_1.sanitizeInput)(null)).toBe('');
        });
        (0, vitest_1.it)('should return empty string for undefined input', () => {
            (0, vitest_1.expect)((0, sanitizer_1.sanitizeInput)(undefined)).toBe('');
        });
        (0, vitest_1.it)('should return empty string for non-string input', () => {
            (0, vitest_1.expect)((0, sanitizer_1.sanitizeInput)(123)).toBe('');
            (0, vitest_1.expect)((0, sanitizer_1.sanitizeInput)({})).toBe('');
        });
        (0, vitest_1.it)('should remove script tags', () => {
            const result = (0, sanitizer_1.sanitizeInput)('<script>alert("xss")</script>Test');
            (0, vitest_1.expect)(result).not.toContain('<script>');
            (0, vitest_1.expect)(result).toContain('Test');
        });
        (0, vitest_1.it)('should remove iframe tags', () => {
            const result = (0, sanitizer_1.sanitizeInput)('<iframe src="evil">Test');
            (0, vitest_1.expect)(result).not.toContain('<iframe>');
            (0, vitest_1.expect)(result).toContain('Test');
        });
        (0, vitest_1.it)('should encode HTML entities in input', () => {
            const result = (0, sanitizer_1.sanitizeInput)('<div onerror="alert(1)">Test</div>');
            (0, vitest_1.expect)(result).not.toContain('onerror');
            (0, vitest_1.expect)(result).toContain('<');
            (0, vitest_1.expect)(result).toContain('>');
        });
        (0, vitest_1.it)('should remove javascript: URLs', () => {
            const result = (0, sanitizer_1.sanitizeInput)('Click <a href="javascript:alert(1)">here</a>');
            (0, vitest_1.expect)(result).not.toContain('javascript:');
        });
        (0, vitest_1.it)('should remove event handlers', () => {
            const result = (0, sanitizer_1.sanitizeInput)('<img onerror="alert(1)" src="test.png">');
            (0, vitest_1.expect)(result).not.toContain('onerror');
        });
        (0, vitest_1.it)('should preserve safe content', () => {
            const result = (0, sanitizer_1.sanitizeInput)('This is a safe message');
            (0, vitest_1.expect)(result).toBe('This is a safe message');
        });
        (0, vitest_1.it)('should preserve punctuation and numbers', () => {
            const result = (0, sanitizer_1.sanitizeInput)('Price: $50.00 (USD) - Valid!');
            (0, vitest_1.expect)(result).toBe('Price: $50.00 (USD) - Valid!');
        });
        (0, vitest_1.it)('should trim whitespace', () => {
            const result = (0, sanitizer_1.sanitizeInput)('  test  ');
            (0, vitest_1.expect)(result).toBe('test');
        });
        (0, vitest_1.it)('should handle empty string', () => {
            (0, vitest_1.expect)((0, sanitizer_1.sanitizeInput)('')).toBe('');
        });
    });
});
