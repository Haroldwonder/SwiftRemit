/**
 * Unit tests for configuration validation functions
 */

const { test, describe } = require('node:test');
const assert = require('assert');

// Validation function implementations (copied from config.js for testing)
function validateFeeBps(feeBps, name) {
  if (feeBps < 0 || feeBps > 10000) {
    throw new Error(`${name} must be between 0 and 10000, got: ${feeBps}`);
  }
}

function validateUrl(url, name) {
  if (!url.startsWith('https://')) {
    throw new Error(`${name} must be an HTTPS URL, got: ${url}`);
  }
}

function validateNetwork(network) {
  if (network !== 'testnet' && network !== 'mainnet') {
    throw new Error(`NETWORK must be 'testnet' or 'mainnet', got: ${network}`);
  }
}

function validatePositiveNumber(value, name) {
  if (value <= 0) {
    throw new Error(`${name} must be a positive number, got: ${value}`);
  }
}

describe('Configuration Validation Functions', () => {
  
  describe('validateFeeBps', () => {
    test('should accept valid fee values (0-10000)', () => {
      // Should not throw for valid values
      assert.doesNotThrow(() => validateFeeBps(0, 'TEST_FEE'));
      assert.doesNotThrow(() => validateFeeBps(250, 'TEST_FEE'));
      assert.doesNotThrow(() => validateFeeBps(10000, 'TEST_FEE'));
    });
    
    test('should reject fee values below 0', () => {
      assert.throws(
        () => validateFeeBps(-1, 'TEST_FEE'),
        /TEST_FEE must be between 0 and 10000, got: -1/
      );
    });
    
    test('should reject fee values above 10000', () => {
      assert.throws(
        () => validateFeeBps(10001, 'TEST_FEE'),
        /TEST_FEE must be between 0 and 10000, got: 10001/
      );
    });
  });
  
  describe('validateUrl', () => {
    test('should accept HTTPS URLs', () => {
      assert.doesNotThrow(() => validateUrl('https://example.com', 'TEST_URL'));
      assert.doesNotThrow(() => validateUrl('https://soroban-testnet.stellar.org:443', 'TEST_URL'));
    });
    
    test('should reject HTTP URLs', () => {
      assert.throws(
        () => validateUrl('http://example.com', 'TEST_URL'),
        /TEST_URL must be an HTTPS URL, got: http:\/\/example.com/
      );
    });
    
    test('should reject non-URL strings', () => {
      assert.throws(
        () => validateUrl('not-a-url', 'TEST_URL'),
        /TEST_URL must be an HTTPS URL, got: not-a-url/
      );
    });
  });
  
  describe('validateNetwork', () => {
    test('should accept testnet', () => {
      assert.doesNotThrow(() => validateNetwork('testnet'));
    });
    
    test('should accept mainnet', () => {
      assert.doesNotThrow(() => validateNetwork('mainnet'));
    });
    
    test('should reject invalid network values', () => {
      assert.throws(
        () => validateNetwork('devnet'),
        /NETWORK must be 'testnet' or 'mainnet', got: devnet/
      );
      
      assert.throws(
        () => validateNetwork('local'),
        /NETWORK must be 'testnet' or 'mainnet', got: local/
      );
    });
  });
  
  describe('validatePositiveNumber', () => {
    test('should accept positive numbers', () => {
      assert.doesNotThrow(() => validatePositiveNumber(1, 'TEST_NUM'));
      assert.doesNotThrow(() => validatePositiveNumber(100, 'TEST_NUM'));
      assert.doesNotThrow(() => validatePositiveNumber(0.1, 'TEST_NUM'));
    });
    
    test('should reject zero', () => {
      assert.throws(
        () => validatePositiveNumber(0, 'TEST_NUM'),
        /TEST_NUM must be a positive number, got: 0/
      );
    });
    
    test('should reject negative numbers', () => {
      assert.throws(
        () => validatePositiveNumber(-1, 'TEST_NUM'),
        /TEST_NUM must be a positive number, got: -1/
      );
    });
  });
});
