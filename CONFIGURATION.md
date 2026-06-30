# Configuration Guide

This guide explains how to configure the SwiftRemit system for different environments using environment variables.

## Overview

SwiftRemit uses environment variables for configuration to support different deployment environments (local development, testnet, mainnet) without modifying code. Configuration is centralized in:

- `.env` file: Your local environment configuration (gitignored)
- `.env.example`: Template with all available configuration options
- `examples/config.js`: JavaScript configuration module that loads and validates environment variables
- Deployment scripts: `deploy.sh` and `deploy.ps1` read environment variables for deployment

## Quick Start

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and fill in your values:
   ```bash
   # Required for client operations
   SWIFTREMIT_CONTRACT_ID=your_contract_id_here
   USDC_TOKEN_ID=your_usdc_token_id_here
   
   # Optional: customize other settings
   NETWORK=testnet
   DEFAULT_FEE_BPS=250
   ```

3. Run your application - configuration is loaded automatically

## Environment Variables Reference

### Network Configuration

#### NETWORK
- **Description**: Stellar network to connect to
- **Type**: String
- **Valid Values**: `testnet`, `mainnet`
- **Default**: `testnet`
- **Example**: `NETWORK=testnet`

#### RPC_URL
- **Description**: RPC endpoint URL for Soroban network
- **Type**: String (HTTPS URL)
- **Default**: `https://soroban-testnet.stellar.org:443`
- **Example**: `RPC_URL=https://soroban-testnet.stellar.org:443`
- **Validation**: Must be an HTTPS URL

### Contract Addresses

#### SWIFTREMIT_CONTRACT_ID
- **Description**: Deployed SwiftRemit contract address
- **Type**: String
- **Required**: Yes (for client operations)
- **Example**: `SWIFTREMIT_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4`

#### USDC_TOKEN_ID
- **Description**: USDC token contract address
- **Type**: String
- **Required**: Yes (for client operations)
- **Example**: `USDC_TOKEN_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4`

### Fee Configuration

#### DEFAULT_FEE_BPS
- **Description**: Default platform fee in basis points (1 bps = 0.01%)
- **Type**: Number
- **Range**: 0-10000 (0% to 100%)
- **Default**: 250 (2.5%)
- **Example**: `DEFAULT_FEE_BPS=250`
- **Validation**: Must be between 0 and 10000

### Transaction Configuration

#### TRANSACTION_FEE
- **Description**: Transaction fee in stroops
- **Type**: String (numeric)
- **Default**: `100000`
- **Example**: `TRANSACTION_FEE=100000`

#### TRANSACTION_TIMEOUT
- **Description**: Transaction timeout in seconds
- **Type**: Number
- **Range**: Positive integer
- **Default**: 30
- **Example**: `TRANSACTION_TIMEOUT=30`

#### POLL_INTERVAL_MS
- **Description**: Polling interval for transaction status in milliseconds
- **Type**: Number
- **Range**: Positive integer
- **Default**: 1000
- **Example**: `POLL_INTERVAL_MS=1000`

### Token Configuration

#### USDC_DECIMALS
- **Description**: Number of decimal places for USDC token
- **Type**: Number
- **Range**: Positive integer
- **Default**: 7
- **Example**: `USDC_DECIMALS=7`

### Account Secrets (Testing Only)

⚠️ **WARNING**: Never commit account secrets to version control. These should only be used for local testing.

#### ADMIN_SECRET
- **Description**: Admin account secret key
- **Type**: String
- **Required**: No (optional for testing)
- **Example**: `ADMIN_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`

#### SENDER_SECRET
- **Description**: Sender account secret key
- **Type**: String
- **Required**: No (optional for testing)
- **Example**: `SENDER_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`

#### AGENT_SECRET
- **Description**: Agent account secret key
- **Type**: String
- **Required**: No (optional for testing)
- **Example**: `AGENT_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`

### Deployment Configuration

#### DEPLOYER_IDENTITY
- **Description**: Soroban CLI identity name for deployment
- **Type**: String
- **Default**: `deployer`
- **Example**: `DEPLOYER_IDENTITY=deployer`

#### INITIAL_FEE_BPS
- **Description**: Initial platform fee for contract initialization (basis points)
- **Type**: Number
- **Range**: 0-10000 (0% to 100%)
- **Default**: 250 (2.5%)
- **Example**: `INITIAL_FEE_BPS=250`
- **Validation**: Must be between 0 and 10000

### Feature Flags

#### ENABLE_DEBUG_LOG
- **Description**: Enable debug logging
- **Type**: Boolean
- **Valid Values**: `true`, `false`
- **Default**: `true`
- **Example**: `ENABLE_DEBUG_LOG=true`

## Configuration Examples

### Local Development

```bash
# .env for local development
NETWORK=testnet
RPC_URL=https://soroban-testnet.stellar.org:443
SWIFTREMIT_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4
USDC_TOKEN_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4
DEFAULT_FEE_BPS=250
TRANSACTION_FEE=100000
TRANSACTION_TIMEOUT=30
POLL_INTERVAL_MS=1000
USDC_DECIMALS=7
DEPLOYER_IDENTITY=deployer
INITIAL_FEE_BPS=250
ENABLE_DEBUG_LOG=true
```

### Testnet Deployment

```bash
# .env for testnet deployment
NETWORK=testnet
RPC_URL=https://soroban-testnet.stellar.org:443
DEPLOYER_IDENTITY=testnet-deployer
INITIAL_FEE_BPS=250
ENABLE_DEBUG_LOG=true
```

### Mainnet Deployment

```bash
# .env for mainnet deployment
NETWORK=mainnet
RPC_URL=https://soroban-mainnet.stellar.org:443
DEPLOYER_IDENTITY=mainnet-deployer
INITIAL_FEE_BPS=200
ENABLE_DEBUG_LOG=false
```

## Relationship Between Environment Variables and Contract Behavior

### On-Chain Constants (Hardcoded in Contract)

These values are hardcoded in the Rust contract code and cannot be changed via environment variables:

- **MAX_FEE_BPS**: 10000 (100%) - Maximum allowed fee
- **FEE_DIVISOR**: 10000 - Used for fee calculation
- **SCHEMA_VERSION**: 1 - Event schema version

These constants ensure consistent on-chain behavior across all deployments.

### Deployment-Time Configuration

These values are set when the contract is deployed and initialized:

- **initial fee_bps**: Set via `INITIAL_FEE_BPS` environment variable during deployment
  - Used in `deploy.sh` and `deploy.ps1`
  - Passed to contract `initialize()` function
  - Can be updated later by admin via `update_fee()` function

### Runtime Configuration (Client-Side)

These values affect client behavior but not on-chain logic:

- Network settings (NETWORK, RPC_URL)
- Transaction parameters (TRANSACTION_FEE, TRANSACTION_TIMEOUT, POLL_INTERVAL_MS)
- Token configuration (USDC_DECIMALS)
- Feature flags (ENABLE_DEBUG_LOG)

## Troubleshooting

### Common Configuration Errors

#### Error: "Missing required environment variable: SWIFTREMIT_CONTRACT_ID"

**Cause**: Required environment variable not set

**Solution**: Add the variable to your `.env` file:
```bash
SWIFTREMIT_CONTRACT_ID=your_contract_id_here
```

#### Error: "DEFAULT_FEE_BPS must be between 0 and 10000, got: 15000"

**Cause**: Fee value outside valid range

**Solution**: Set fee to a value between 0 and 10000:
```bash
DEFAULT_FEE_BPS=250
```

#### Error: "RPC_URL must be an HTTPS URL, got: http://example.com"

**Cause**: Non-HTTPS URL provided

**Solution**: Use HTTPS URL:
```bash
RPC_URL=https://soroban-testnet.stellar.org:443
```

#### Error: "NETWORK must be 'testnet' or 'mainnet', got: devnet"

**Cause**: Invalid network value

**Solution**: Use valid network value:
```bash
NETWORK=testnet
```

#### Error: "Invalid number for TRANSACTION_TIMEOUT: abc"

**Cause**: Non-numeric value for numeric configuration

**Solution**: Provide numeric value:
```bash
TRANSACTION_TIMEOUT=30
```

### Validation Behavior

The configuration module validates all values at startup (fail-fast approach):

1. All required variables must be present
2. Numeric values must be valid numbers
3. Numeric values must be within valid ranges
4. URLs must be properly formatted HTTPS URLs
5. Network must be 'testnet' or 'mainnet'

If any validation fails, the application will throw a descriptive error and exit before executing any business logic.

### Debugging Configuration Issues

1. Check that `.env` file exists in the project root
2. Verify `.env` file is not empty
3. Ensure no typos in variable names
4. Check that values match expected types and ranges
5. Look for error messages that indicate which variable is invalid

## Security Best Practices

1. **Never commit `.env` files**: The `.env` file is gitignored to prevent committing secrets
2. **Use `.env.example` as template**: Keep `.env.example` updated with all variables (without sensitive values)
3. **Rotate secrets regularly**: Change account secrets periodically
4. **Use different secrets per environment**: Don't reuse testnet secrets on mainnet
5. **Limit secret access**: Only share secrets with authorized team members
6. **Use environment-specific identities**: Create separate Soroban identities for testnet and mainnet

## Additional Resources

- [Stellar Documentation](https://developers.stellar.org/)
- [Soroban Documentation](https://soroban.stellar.org/)
- [dotenv Documentation](https://github.com/motdotla/dotenv)
