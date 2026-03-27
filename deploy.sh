#!/bin/bash
set -e

# Configuration - Read from environment with defaults
NETWORK=${NETWORK:-testnet}
DEPLOYER=${DEPLOYER_IDENTITY:-deployer}
INITIAL_FEE_BPS=${INITIAL_FEE_BPS:-250}
WASM_PATH="target/wasm32-unknown-unknown/release/swiftremit.optimized.wasm"

# Allow CLI override for NETWORK (first argument)
if [ -n "$1" ]; then
  NETWORK=$1
fi

# Validate INITIAL_FEE_BPS range (0-10000)
if [ "$INITIAL_FEE_BPS" -lt 0 ] || [ "$INITIAL_FEE_BPS" -gt 10000 ]; then
  echo "❌ Error: INITIAL_FEE_BPS must be between 0 and 10000, got: $INITIAL_FEE_BPS"
  exit 1
fi

echo "🚀 SwiftRemit Deployment Script"
echo "Network: $NETWORK"
echo "Deployer Identity: $DEPLOYER"

# Check prerequisites
if ! command -v soroban &> /dev/null; then
    echo "❌ Soroban CLI not found. Please install it first."
    exit 1
fi

# Setup Identity
echo "Checking identity..."
if ! soroban keys address $DEPLOYER > /dev/null 2>&1; then
    echo "Creating new identity '$DEPLOYER'..."
    soroban keys generate --global $DEPLOYER --network $NETWORK
else
    echo "Identity '$DEPLOYER' found."
fi

ADDRESS=$(soroban keys address $DEPLOYER)
echo "Address: $ADDRESS"

# Fund Identity (attempt on testnet/standalone, skip on mainnet)
if [ "$NETWORK" != "mainnet" ]; then
    echo "Funding identity (this may take a moment)..."
    soroban keys fund $DEPLOYER --network $NETWORK || echo "Funding warning: Request may have failed or account already funded (or network doesn't support funding)."
fi

# Build and Optimize
echo "🔨 Building and Optimizing Contract..."
# Note: To enable debug logging for local testing, add: --features debug-log
cargo build --target wasm32-unknown-unknown --release
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/swiftremit.wasm

if [ ! -f "$WASM_PATH" ]; then
    echo "❌ Build failed. $WASM_PATH not found."
    exit 1
fi

# Deploy Contract
echo "📤 Deploying Contract..."
CONTRACT_ID=$(soroban contract deploy \
  --wasm $WASM_PATH \
  --source $DEPLOYER \
  --network $NETWORK)

echo "✅ Contract Deployed: $CONTRACT_ID"

# Deploy Mock USDC Token
echo "💰 Deploying Mock USDC Token..."
USDC_ID=$(soroban contract asset deploy \
  --asset "USDC:$ADDRESS" \
  --source $DEPLOYER \
  --network $NETWORK)

echo "✅ USDC Token Deployed: $USDC_ID"

# Initialize Contract
echo "⚙️ Initializing Contract..."
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $DEPLOYER \
  --network $NETWORK \
  -- \
  initialize \
  --admin $ADDRESS \
  --usdc_token $USDC_ID \
  --fee_bps 250

echo ""
echo "🎉 Deployment Complete!"
echo "----------------------------------------"
echo "Contract ID: $CONTRACT_ID"
echo "USDC Token ID: $USDC_ID"
echo "Admin Address: $ADDRESS"
echo "----------------------------------------"

# Save to .env file for frontend use
echo "NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID" > .env.local
echo "NEXT_PUBLIC_USDC_TOKEN_ADDRESS=$USDC_ID" >> .env.local
echo "IDs saved to .env.local"
