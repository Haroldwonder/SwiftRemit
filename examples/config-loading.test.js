/**
 * Integration tests for configuration module loading
 * Tests that the config module loads and validates configuration correctly
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('assert');

describe('Configuration Module Loading', () => {
  
  test('should load configuration with default values', () => {
    // Set minimal required environment
    process.env.NETWORK = 'testnet';
    process.env.RPC_URL = 'https://soroban-testnet.stellar.org:443';
    
    // Clear the require cache to reload config
    delete require.cache[require.resolve('./config.js')];
    
    // Load config module
    const config = require('./config.js');
    
    // Verify network configuration
    assert.strictEqual(config.network, 'testnet');
    assert.strictEqual(config.rpcUrl, 'https://soroban-testnet.stellar.org:443');
    assert.strictEqual(config.networkPassphrase, 'Test SDF Network ; September 2015');
    
    // Verify fee configuration
    assert.strictEqual(config.defaultFeeBps, 250);
    assert.strictEqual(config.maxFeeBps, 10000);
    assert.strictEqual(config.feeDivisor, 10000);
    
    // Verify transaction configuration
    assert.strictEqual(config.transactionFee, '100000');
    assert.strictEqual(config.transactionTimeout, 30);
    assert.strictEqual(config.pollIntervalMs, 1000);
    
    // Verify token configuration
    assert.strictEqual(config.usdcDecimals, 7);
    assert.strictEqual(config.usdcMultiplier, 10000000);
    
    // Verify deployment configuration
    assert.strictEqual(config.deployerIdentity, 'deployer');
    assert.strictEqual(config.initialFeeBps, 250);
    
    // Verify feature flags
    assert.strictEqual(config.enableDebugLog, true);
    
    // Verify constants
    assert.strictEqual(config.schemaVersion, 1);
    
    // Verify optional secrets are null when not provided
    assert.strictEqual(config.adminSecret, null);
    assert.strictEqual(config.senderSecret, null);
    assert.strictEqual(config.agentSecret, null);
  });
  
  test('should load configuration with custom values', () => {
    // Set custom environment variables
    process.env.NETWORK = 'mainnet';
    process.env.RPC_URL = 'https://soroban-mainnet.stellar.org:443';
    process.env.DEFAULT_FEE_BPS = '500';
    process.env.TRANSACTION_FEE = '200000';
    process.env.TRANSACTION_TIMEOUT = '60';
    process.env.POLL_INTERVAL_MS = '2000';
    process.env.USDC_DECIMALS = '6';
    process.env.DEPLOYER_IDENTITY = 'custom-deployer';
    process.env.INITIAL_FEE_BPS = '300';
    process.env.ENABLE_DEBUG_LOG = 'false';
    process.env.SWIFTREMIT_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    process.env.USDC_TOKEN_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5';
    
    // Clear the require cache to reload config
    delete require.cache[require.resolve('./config.js')];
    
    // Load config module
    const config = require('./config.js');
    
    // Verify custom values
    assert.strictEqual(config.network, 'mainnet');
    assert.strictEqual(config.rpcUrl, 'https://soroban-mainnet.stellar.org:443');
    assert.strictEqual(config.networkPassphrase, 'Public Global Stellar Network ; September 2015');
    assert.strictEqual(config.defaultFeeBps, 500);
    assert.strictEqual(config.transactionFee, '200000');
    assert.strictEqual(config.transactionTimeout, 60);
    assert.strictEqual(config.pollIntervalMs, 2000);
    assert.strictEqual(config.usdcDecimals, 6);
    assert.strictEqual(config.usdcMultiplier, 1000000);
    assert.strictEqual(config.deployerIdentity, 'custom-deployer');
    assert.strictEqual(config.initialFeeBps, 300);
    assert.strictEqual(config.enableDebugLog, false);
    assert.strictEqual(config.contractId, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4');
    assert.strictEqual(config.usdcTokenId, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5');
  });
  
  test('should throw error for invalid network', () => {
    process.env.NETWORK = 'devnet';
    
    // Clear the require cache
    delete require.cache[require.resolve('./config.js')];
    
    // Should throw when loading config
    assert.throws(
      () => require('./config.js'),
      /NETWORK must be 'testnet' or 'mainnet', got: devnet/
    );
    
    // Reset for other tests
    process.env.NETWORK = 'testnet';
  });
  
  test('should throw error for invalid RPC URL', () => {
    process.env.RPC_URL = 'http://insecure.example.com';
    
    // Clear the require cache
    delete require.cache[require.resolve('./config.js')];
    
    // Should throw when loading config
    assert.throws(
      () => require('./config.js'),
      /RPC_URL must be an HTTPS URL/
    );
    
    // Reset for other tests
    process.env.RPC_URL = 'https://soroban-testnet.stellar.org:443';
  });
  
  test('should throw error for invalid DEFAULT_FEE_BPS', () => {
    process.env.DEFAULT_FEE_BPS = '15000';
    
    // Clear the require cache
    delete require.cache[require.resolve('./config.js')];
    
    // Should throw when loading config
    assert.throws(
      () => require('./config.js'),
      /DEFAULT_FEE_BPS must be between 0 and 10000, got: 15000/
    );
    
    // Reset for other tests
    process.env.DEFAULT_FEE_BPS = '250';
  });
  
  test('should throw error for invalid INITIAL_FEE_BPS', () => {
    process.env.INITIAL_FEE_BPS = '-100';
    
    // Clear the require cache
    delete require.cache[require.resolve('./config.js')];
    
    // Should throw when loading config
    assert.throws(
      () => require('./config.js'),
      /INITIAL_FEE_BPS must be between 0 and 10000, got: -100/
    );
    
    // Reset for other tests
    process.env.INITIAL_FEE_BPS = '250';
  });
  
  test('should throw error for invalid TRANSACTION_TIMEOUT', () => {
    process.env.TRANSACTION_TIMEOUT = '0';
    
    // Clear the require cache
    delete require.cache[require.resolve('./config.js')];
    
    // Should throw when loading config
    assert.throws(
      () => require('./config.js'),
      /TRANSACTION_TIMEOUT must be a positive number, got: 0/
    );
    
    // Reset for other tests
    process.env.TRANSACTION_TIMEOUT = '30';
  });
  
  test('should throw error for invalid POLL_INTERVAL_MS', () => {
    process.env.POLL_INTERVAL_MS = '-500';
    
    // Clear the require cache
    delete require.cache[require.resolve('./config.js')];
    
    // Should throw when loading config
    assert.throws(
      () => require('./config.js'),
      /POLL_INTERVAL_MS must be a positive number/
    );
    
    // Reset for other tests
    process.env.POLL_INTERVAL_MS = '1000';
  });
  
  test('should throw error for invalid USDC_DECIMALS', () => {
    process.env.USDC_DECIMALS = '0';
    
    // Clear the require cache
    delete require.cache[require.resolve('./config.js')];
    
    // Should throw when loading config
    assert.throws(
      () => require('./config.js'),
      /USDC_DECIMALS must be a positive number, got: 0/
    );
    
    // Reset for other tests
    process.env.USDC_DECIMALS = '7';
  });
  
  test('should throw error for non-numeric TRANSACTION_FEE', () => {
    process.env.TRANSACTION_FEE = 'not-a-number';
    
    // Clear the require cache
    delete require.cache[require.resolve('./config.js')];
    
    // Should throw when loading config
    assert.throws(
      () => require('./config.js'),
      /TRANSACTION_FEE must be a numeric string/
    );
    
    // Reset for other tests
    process.env.TRANSACTION_FEE = '100000';
  });
  
  test('should load optional account secrets when provided', () => {
    process.env.ADMIN_SECRET = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    process.env.SENDER_SECRET = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5';
    process.env.AGENT_SECRET = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC6';
    
    // Clear the require cache
    delete require.cache[require.resolve('./config.js')];
    
    // Load config module
    const config = require('./config.js');
    
    // Verify secrets are loaded
    assert.strictEqual(config.adminSecret, 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4');
    assert.strictEqual(config.senderSecret, 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5');
    assert.strictEqual(config.agentSecret, 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC6');
    
    // Clean up
    delete process.env.ADMIN_SECRET;
    delete process.env.SENDER_SECRET;
    delete process.env.AGENT_SECRET;
  });
});
