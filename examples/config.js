/**
 * SwiftRemit Configuration Module
 * 
 * Centralized configuration management with validation and type safety.
 * Loads environment variables from .env files and validates them at startup.
 * 
 * Usage:
 *   const config = require('./config');
 *   console.log(config.network); // 'testnet'
 */

// Load environment variables from .env file
require('dotenv').config();

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get a required environment variable
 * Throws an error if the variable is not set
 * 
 * @param {string} name - Environment variable name
 * @returns {string} - Environment variable value
 * @throws {Error} - If variable is missing
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

/**
 * Get an optional environment variable with a default value
 * 
 * @param {string} name - Environment variable name
 * @param {string} defaultValue - Default value if not set
 * @returns {string} - Environment variable value or default
 */
function getEnv(name, defaultValue) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    return defaultValue;
  }
  return value.trim();
}

/**
 * Parse an environment variable as a number
 * 
 * @param {string} name - Environment variable name
 * @param {number} defaultValue - Default value if not set
 * @returns {number} - Parsed number value
 * @throws {Error} - If value cannot be parsed as a number
 */
function parseNumber(name, defaultValue) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    return defaultValue;
  }
  const parsed = parseInt(value.trim(), 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for ${name}: ${value}`);
  }
  return parsed;
}

/**
 * Parse an environment variable as a boolean
 * 
 * @param {string} name - Environment variable name
 * @param {boolean} defaultValue - Default value if not set
 * @returns {boolean} - Parsed boolean value
 */
function parseBoolean(name, defaultValue) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    return defaultValue;
  }
  return value.trim().toLowerCase() === 'true';
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate fee in basis points (0-10000 range)
 * 
 * @param {number} feeBps - Fee value in basis points
 * @param {string} name - Variable name for error messages
 * @throws {Error} - If fee is outside valid range
 */
function validateFeeBps(feeBps, name) {
  if (feeBps < 0 || feeBps > 10000) {
    throw new Error(`${name} must be between 0 and 10000, got: ${feeBps}`);
  }
}

/**
 * Validate URL is HTTPS
 * 
 * @param {string} url - URL to validate
 * @param {string} name - Variable name for error messages
 * @throws {Error} - If URL is not HTTPS
 */
function validateUrl(url, name) {
  if (!url.startsWith('https://')) {
    throw new Error(`${name} must be an HTTPS URL, got: ${url}`);
  }
}

/**
 * Validate network is testnet or mainnet
 * 
 * @param {string} network - Network value to validate
 * @throws {Error} - If network is not testnet or mainnet
 */
function validateNetwork(network) {
  if (network !== 'testnet' && network !== 'mainnet') {
    throw new Error(`NETWORK must be 'testnet' or 'mainnet', got: ${network}`);
  }
}

/**
 * Validate number is positive
 * 
 * @param {number} value - Number to validate
 * @param {string} name - Variable name for error messages
 * @throws {Error} - If number is not positive
 */
function validatePositiveNumber(value, name) {
  if (value <= 0) {
    throw new Error(`${name} must be a positive number, got: ${value}`);
  }
}

// ============================================
// LOAD AND VALIDATE CONFIGURATION
// ============================================

// Network Configuration
const network = getEnv('NETWORK', 'testnet');
validateNetwork(network);

const rpcUrl = getEnv('RPC_URL', 'https://soroban-testnet.stellar.org:443');
validateUrl(rpcUrl, 'RPC_URL');

// Derive network passphrase from network
const networkPassphrase = network === 'testnet' 
  ? 'Test SDF Network ; September 2015'
  : 'Public Global Stellar Network ; September 2015';

// Contract Addresses
// These are optional at module load time but required for actual operations
const contractId = getEnv('SWIFTREMIT_CONTRACT_ID', '');
const usdcTokenId = getEnv('USDC_TOKEN_ID', '');

// Fee Configuration
const defaultFeeBps = parseNumber('DEFAULT_FEE_BPS', 250);
validateFeeBps(defaultFeeBps, 'DEFAULT_FEE_BPS');

// Constants (hardcoded in contract, documented here for reference)
const maxFeeBps = 10000;
const feeDivisor = 10000;

// Transaction Configuration
const transactionFee = getEnv('TRANSACTION_FEE', '100000');
// Validate it's a numeric string
if (!/^\d+$/.test(transactionFee)) {
  throw new Error(`TRANSACTION_FEE must be a numeric string, got: ${transactionFee}`);
}

const transactionTimeout = parseNumber('TRANSACTION_TIMEOUT', 30);
validatePositiveNumber(transactionTimeout, 'TRANSACTION_TIMEOUT');

const pollIntervalMs = parseNumber('POLL_INTERVAL_MS', 1000);
validatePositiveNumber(pollIntervalMs, 'POLL_INTERVAL_MS');

// Token Configuration
const usdcDecimals = parseNumber('USDC_DECIMALS', 7);
validatePositiveNumber(usdcDecimals, 'USDC_DECIMALS');

// Calculate USDC multiplier (10^decimals)
const usdcMultiplier = Math.pow(10, usdcDecimals);

// Account Configuration (optional)
const adminSecret = getEnv('ADMIN_SECRET', '') || null;
const senderSecret = getEnv('SENDER_SECRET', '') || null;
const agentSecret = getEnv('AGENT_SECRET', '') || null;

// Deployment Configuration
const deployerIdentity = getEnv('DEPLOYER_IDENTITY', 'deployer');

const initialFeeBps = parseNumber('INITIAL_FEE_BPS', 250);
validateFeeBps(initialFeeBps, 'INITIAL_FEE_BPS');

// Feature Flags
const enableDebugLog = parseBoolean('ENABLE_DEBUG_LOG', true);

// Constants
const schemaVersion = 1;

// ============================================
// EXPORT CONFIGURATION OBJECT AND FUNCTIONS
// ============================================

/**
 * SwiftRemit Configuration Object
 * 
 * Contains all configuration values loaded from environment variables,
 * with sensible defaults and validation applied.
 * 
 * @typedef {Object} SwiftRemitConfig
 * @property {string} network - Blockchain network ('testnet' or 'mainnet')
 * @property {string} networkPassphrase - Stellar network passphrase for signing
 * @property {string} rpcUrl - RPC endpoint URL (must be HTTPS)
 * @property {string} contractId - SwiftRemit contract ID on the blockchain
 * @property {string} usdcTokenId - USDC token contract ID
 * @property {number} defaultFeeBps - Default fee in basis points (0-10000)
 * @property {number} maxFeeBps - Maximum allowed fee in basis points (constant: 10000)
 * @property {number} feeDivisor - Divisor for basis points calculations (constant: 10000)
 * @property {string} transactionFee - Base transaction fee in stroops (numeric string)
 * @property {number} transactionTimeout - Transaction timeout in seconds
 * @property {number} pollIntervalMs - Polling interval in milliseconds
 * @property {number} usdcDecimals - USDC token decimals
 * @property {number} usdcMultiplier - Multiplier for USDC calculations (10^decimals)
 * @property {string|null} adminSecret - Admin keypair secret (optional)
 * @property {string|null} senderSecret - Sender keypair secret (optional)
 * @property {string|null} agentSecret - Agent keypair secret (optional)
 * @property {string} deployerIdentity - Deployer identity name
 * @property {number} initialFeeBps - Initial fee in basis points (0-10000)
 * @property {boolean} enableDebugLog - Whether debug logging is enabled
 * @property {number} schemaVersion - Configuration schema version (constant: 1)
 * @property {Function} requireEnv - Get required environment variable
 * @property {Function} getEnv - Get optional environment variable with default
 * @property {Function} parseNumber - Parse environment variable as number
 * @property {Function} parseBoolean - Parse environment variable as boolean
 * @property {Function} validateFeeBps - Validate fee in basis points
 * @property {Function} validateUrl - Validate URL is HTTPS
 * @property {Function} validateNetwork - Validate network is testnet or mainnet
 * @property {Function} validatePositiveNumber - Validate number is positive
 */

module.exports = {
  // Network Configuration
  network,
  networkPassphrase,
  rpcUrl,
  
  // Contract Addresses
  contractId,
  usdcTokenId,
  
  // Fee Configuration
  defaultFeeBps,
  maxFeeBps,
  feeDivisor,
  
  // Transaction Configuration
  transactionFee,
  transactionTimeout,
  pollIntervalMs,
  
  // Token Configuration
  usdcDecimals,
  usdcMultiplier,
  
  // Account Configuration (optional)
  adminSecret,
  senderSecret,
  agentSecret,
  
  // Deployment Configuration
  deployerIdentity,
  initialFeeBps,
  
  // Feature Flags
  enableDebugLog,
  
  // Constants
  schemaVersion,
  
  // Export helper and validation functions for client usage
  requireEnv,
  getEnv,
  parseNumber,
  parseBoolean,
  validateFeeBps,
  validateUrl,
  validateNetwork,
  validatePositiveNumber,
};
