# SwiftRemit Testnet Setup Guide

Complete guide for getting testnet XLM and USDC, setting up a local sandbox, and running the full SwiftRemit remittance flow end-to-end.

## Quick Start Checklist

- [ ] Install Soroban CLI
- [ ] Get testnet XLM from Friendbot
- [ ] Get testnet USDC tokens
- [ ] Deploy SwiftRemit contract
- [ ] Set up wallet (Freighter)
- [ ] Run end-to-end remittance flow

## Prerequisites

### Required Tools

```bash
# Install Rust and Cargo
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Add WebAssembly target
rustup target add wasm32-unknown-unknown

# Install Soroban CLI
cargo install --locked soroban-cli

# Verify installation
soroban --version
```

### Required Accounts

You'll need at least 2 Stellar accounts for testing:
- **Sender account**: Creates remittances
- **Agent account**: Confirms payouts and receives funds

## Step 1: Get Testnet XLM

### Method 1: Stellar Friendbot (Recommended)

Friendbot provides 10,000 XLM per request for testnet accounts.

```bash
# Generate a new keypair
soroban keys generate --global sender --network testnet
soroban keys generate --global agent --network testnet

# Get the public keys
SENDER_ADDRESS=$(soroban keys address sender)
AGENT_ADDRESS=$(soroban keys address agent)

echo "Sender: $SENDER_ADDRESS"
echo "Agent: $AGENT_ADDRESS"

# Fund accounts via Friendbot
curl "https://friendbot.stellar.org/?addr=$SENDER_ADDRESS"
curl "https://friendbot.stellar.org/?addr=$AGENT_ADDRESS"
```

### Method 2: Stellar Laboratory

1. Go to [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test)
2. Click "Generate keypair"
3. Save the **Secret Key** securely
4. Click "Fund account with Friendbot"
5. Verify funding on [Stellar Expert Testnet](https://stellar.expert/explorer/testnet)

### Verify XLM Balance

```bash
# Check balance via Soroban CLI
soroban keys fund sender --network testnet

# Or check via Horizon API
curl "https://horizon-testnet.stellar.org/accounts/$SENDER_ADDRESS"
```

Expected result: ~10,000 XLM balance

## Step 2: Get Testnet USDC

### Option A: Use Mock USDC (Easiest)

The deployment script automatically creates a mock USDC token:

```bash
# Deploy creates both contract and mock USDC
./deploy.sh testnet
```

The mock USDC token ID will be saved to `.env.local`.

### Option B: Use Official Testnet USDC

For more realistic testing, use Circle's official testnet USDC:

```bash
# Official testnet USDC token
USDC_TOKEN="CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"

# Create trustline to USDC
soroban contract invoke \
  --id $USDC_TOKEN \
  --source sender \
  --network testnet \
  -- \
  mint \
  --to $SENDER_ADDRESS \
  --amount 1000000000000
```

### Option C: Testnet USDC Faucets

Several testnet faucets provide USDC:

1. **Stellar Quest Faucet**: https://quest.stellar.org/
2. **StellarX Testnet**: Create account and use built-in faucet
3. **Lobstr Testnet**: Mobile app with testnet mode

### Verify USDC Balance

```bash
# Check USDC balance
soroban contract invoke \
  --id $USDC_TOKEN \
  --source sender \
  --network testnet \
  -- \
  balance \
  --id $SENDER_ADDRESS
```

## Step 3: Deploy SwiftRemit Contract

### Automated Deployment

```bash
# Clone the repository
git clone https://github.com/yourusername/SwiftRemit.git
cd SwiftRemit

# Run deployment script
chmod +x deploy.sh
./deploy.sh testnet
```

This will:
- Build and optimize the contract
- Deploy to testnet
- Deploy mock USDC token
- Initialize the contract
- Save contract IDs to `.env.local`

### Manual Deployment

```bash
# Build contract
cargo build --target wasm32-unknown-unknown --release
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/swiftremit.wasm

# Deploy contract
CONTRACT_ID=$(soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/swiftremit.optimized.wasm \
  --source sender \
  --network testnet)

# Deploy USDC token
USDC_ID=$(soroban contract asset deploy \
  --asset "USDC:$SENDER_ADDRESS" \
  --source sender \
  --network testnet)

# Initialize contract
soroban contract invoke \
  --id $CONTRACT_ID \
  --source sender \
  --network testnet \
  -- \
  initialize \
  --admin $SENDER_ADDRESS \
  --usdc_token $USDC_ID \
  --fee_bps 250

echo "Contract ID: $CONTRACT_ID"
echo "USDC Token ID: $USDC_ID"
```

## Step 4: Set Up Local Sandbox (Optional)

For faster development, run a local Stellar network:

### Install Stellar Quickstart

```bash
# Using Docker
docker run --rm -it -p 8000:8000 \
  --name stellar \
  stellar/quickstart:latest \
  --testnet \
  --enable-soroban-rpc

# Or using stellar-core directly
stellar-core --conf stellar-core.cfg
```

### Configure for Local Network

```bash
# Set environment for local network
export SOROBAN_RPC_URL="http://localhost:8000/soroban/rpc"
export SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Deploy to local network
./deploy.sh standalone
```

## Step 5: Set Up Wallet (Freighter)

### Install Freighter Extension

1. Install [Freighter](https://www.freighter.app/) browser extension
2. Create a new wallet or import existing keys
3. Switch to **Testnet** network:
   - Click Freighter icon
   - Settings → Network → Testnet

### Import Test Accounts

```bash
# Get your secret keys
soroban keys show sender
soroban keys show agent

# In Freighter:
# 1. Click "Add Account"
# 2. Select "Import using secret key"
# 3. Paste the secret key
# 4. Name it "Testnet Sender" or "Testnet Agent"
```

## Step 6: Run End-to-End Flow

### Method A: Using Frontend Application

```bash
# Start the frontend
cd frontend
npm install
cp .env.example .env

# Edit .env with your contract IDs
echo "VITE_CONTRACT_ID=$CONTRACT_ID" >> .env
echo "VITE_USDC_TOKEN_ID=$USDC_ID" >> .env

# Start development server
npm run dev
```

Open http://localhost:5173 and:

1. **Connect Wallet**: Click "Connect Wallet" → Approve in Freighter
2. **Create Remittance**: 
   - Enter agent address
   - Enter amount (e.g., 100 USDC)
   - Click "Create Remittance"
   - Approve transaction in Freighter
3. **Confirm Payout** (as agent):
   - Switch to agent account in Freighter
   - Find the remittance ID
   - Click "Confirm Payout"
   - Approve transaction

### Method B: Using CLI Commands

```bash
# 1. Register agent
soroban contract invoke \
  --id $CONTRACT_ID \
  --source sender \
  --network testnet \
  -- \
  register_agent \
  --agent $AGENT_ADDRESS

# 2. Approve USDC transfer
soroban contract invoke \
  --id $USDC_ID \
  --source sender \
  --network testnet \
  -- \
  approve \
  --from $SENDER_ADDRESS \
  --spender $CONTRACT_ID \
  --amount 1000000000

# 3. Create remittance
REMITTANCE_ID=$(soroban contract invoke \
  --id $CONTRACT_ID \
  --source sender \
  --network testnet \
  -- \
  create_remittance \
  --sender $SENDER_ADDRESS \
  --agent $AGENT_ADDRESS \
  --amount 1000000000)

echo "Remittance ID: $REMITTANCE_ID"

# 4. Confirm payout (as agent)
soroban contract invoke \
  --id $CONTRACT_ID \
  --source agent \
  --network testnet \
  -- \
  confirm_payout \
  --remittance_id $REMITTANCE_ID
```

### Method C: Using Integration Tests

```bash
# Set up test environment
cp .env.testnet .env.testnet.local

# Edit .env.testnet.local with your values:
# SWIFTREMIT_CONTRACT_ID=your_contract_id
# USDC_TOKEN_ID=your_usdc_id
# TESTNET_SENDER_SECRET=your_sender_secret
# TESTNET_AGENT_SECRET=your_agent_secret

# Run integration tests
cargo test --features testnet-integration --test-threads=1 -- testnet
```

## Verification and Monitoring

### Check Remittance Status

```bash
# Get remittance details
soroban contract invoke \
  --id $CONTRACT_ID \
  --source sender \
  --network testnet \
  -- \
  get_remittance \
  --remittance_id $REMITTANCE_ID
```

### Monitor Events

```bash
# Watch contract events
soroban events --start-ledger latest --id $CONTRACT_ID --network testnet
```

### Check Balances

```bash
# Check USDC balances
soroban contract invoke \
  --id $USDC_ID \
  --source sender \
  --network testnet \
  -- \
  balance \
  --id $SENDER_ADDRESS

soroban contract invoke \
  --id $USDC_ID \
  --source agent \
  --network testnet \
  -- \
  balance \
  --id $AGENT_ADDRESS
```

## Troubleshooting

### Common Issues

**"Account not found" error:**
```bash
# Fund the account first
curl "https://friendbot.stellar.org/?addr=$YOUR_ADDRESS"
```

**"Insufficient balance" error:**
```bash
# Check XLM balance for fees
curl "https://horizon-testnet.stellar.org/accounts/$YOUR_ADDRESS"

# Get more XLM if needed
curl "https://friendbot.stellar.org/?addr=$YOUR_ADDRESS"
```

**"Contract not found" error:**
```bash
# Verify contract deployment
soroban contract info --id $CONTRACT_ID --network testnet
```

**USDC transfer fails:**
```bash
# Check USDC balance
soroban contract invoke --id $USDC_ID --source sender --network testnet -- balance --id $SENDER_ADDRESS

# Create trustline if needed
soroban contract invoke --id $USDC_ID --source sender --network testnet -- approve --from $SENDER_ADDRESS --spender $CONTRACT_ID --amount 10000000000
```

### Reset Environment

```bash
# Generate fresh accounts
soroban keys generate --global sender-new --network testnet
soroban keys generate --global agent-new --network testnet

# Fund new accounts
curl "https://friendbot.stellar.org/?addr=$(soroban keys address sender-new)"
curl "https://friendbot.stellar.org/?addr=$(soroban keys address agent-new)"

# Redeploy contract
./deploy.sh testnet
```

### Network Status

Check Stellar testnet status:
- **Horizon**: https://horizon-testnet.stellar.org/
- **Soroban RPC**: https://soroban-testnet.stellar.org/
- **Status Page**: https://status.stellar.org/

## Advanced Configuration

### Custom Network Configuration

```bash
# Add custom network
soroban network add \
  --global custom-testnet \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015"

# Use custom network
./deploy.sh custom-testnet
```

### Environment Variables

Create `.env` file for consistent configuration:

```bash
# Network Configuration
NETWORK=testnet
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org:443
HORIZON_URL=https://horizon-testnet.stellar.org

# Contract Configuration
SWIFTREMIT_CONTRACT_ID=your_contract_id
USDC_TOKEN_ID=your_usdc_token_id
DEFAULT_FEE_BPS=250

# Account Configuration
DEPLOYER_IDENTITY=deployer
SENDER_IDENTITY=sender
AGENT_IDENTITY=agent
```

### Batch Operations

```bash
# Create multiple remittances
for i in {1..5}; do
  soroban contract invoke \
    --id $CONTRACT_ID \
    --source sender \
    --network testnet \
    -- \
    create_remittance \
    --sender $SENDER_ADDRESS \
    --agent $AGENT_ADDRESS \
    --amount $((100000000 * i))
done
```

## Production Considerations

When moving to mainnet:

1. **Use real USDC**: `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
2. **Secure key management**: Use hardware wallets or secure key storage
3. **Monitor gas costs**: XLM fees on mainnet
4. **Test thoroughly**: Run full test suite before mainnet deployment
5. **Set appropriate fees**: Consider market rates for fee_bps

## Resources

- **Stellar Documentation**: https://developers.stellar.org/
- **Soroban Documentation**: https://soroban.stellar.org/
- **Testnet Explorer**: https://stellar.expert/explorer/testnet
- **Friendbot**: https://friendbot.stellar.org/
- **Laboratory**: https://laboratory.stellar.org/
- **SwiftRemit Repository**: https://github.com/yourusername/SwiftRemit

## Support

For issues and questions:
- **GitHub Issues**: [Create an issue](https://github.com/yourusername/SwiftRemit/issues)
- **Stellar Discord**: https://discord.gg/stellar
- **Documentation**: See project README and DEPLOYMENT.md

---

*Last updated: April 2026*