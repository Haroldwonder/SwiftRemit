# SwiftRemit Quick Start

Get up and running with SwiftRemit on Stellar testnet in minutes.

## 🚀 One-Command Setup

**Linux/macOS:**
```bash
./setup-testnet.sh
```

**Windows (PowerShell):**
```powershell
.\setup-testnet.ps1
```

This automated script will:
- ✅ Generate test accounts and fund them with XLM
- ✅ Deploy SwiftRemit contract and mock USDC token
- ✅ Register an agent and mint test USDC
- ✅ Run a complete test remittance flow
- ✅ Save all configuration to `.env.local`

## 📖 Detailed Guide

For step-by-step instructions and troubleshooting, see:
**[TESTNET_SETUP_GUIDE.md](TESTNET_SETUP_GUIDE.md)**

## 🎯 What You Get

After running the setup script:

### Accounts Created
- **Sender Account**: Creates remittances, funded with 10,000 XLM + 10,000 USDC
- **Agent Account**: Confirms payouts, funded with 10,000 XLM
- **Deployer Account**: Contract admin, funded with 10,000 XLM

### Contracts Deployed
- **SwiftRemit Contract**: Main remittance logic
- **Mock USDC Token**: For testing transfers

### Configuration Files
- `.env.local`: Frontend/backend configuration
- `.env.testnet.local`: Integration test configuration

## 🌐 Next Steps

### 1. Set Up Wallet

Install [Freighter](https://www.freighter.app/) and import your test accounts:

```bash
# Get your account secret keys
soroban keys show sender
soroban keys show agent
```

### 2. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and connect your wallet.

### 3. Run Integration Tests

```bash
cargo test --features testnet-integration --test-threads=1 -- testnet
```

### 4. Start Backend Services

```bash
# API service
cd api
npm install
npm run dev

# Backend service (webhooks, verification)
cd backend
npm install
npm run dev
```

## 🔧 Manual Setup

If you prefer manual setup or need to customize the process:

1. **Install Prerequisites**
   ```bash
   # Install Rust and Soroban CLI
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   cargo install --locked soroban-cli
   ```

2. **Get Testnet XLM**
   ```bash
   # Generate accounts
   soroban keys generate --global sender --network testnet
   
   # Fund via Friendbot
   curl "https://friendbot.stellar.org/?addr=$(soroban keys address sender)"
   ```

3. **Deploy Contract**
   ```bash
   ./deploy.sh testnet
   ```

See [TESTNET_SETUP_GUIDE.md](TESTNET_SETUP_GUIDE.md) for complete manual instructions.

## 🧪 Testing Your Setup

### CLI Test Flow

```bash
# Source your configuration
source .env.local

# Create a remittance
soroban contract invoke \
  --id $SWIFTREMIT_CONTRACT_ID \
  --source sender \
  --network testnet \
  -- \
  create_remittance \
  --sender $SENDER_ADDRESS \
  --agent $AGENT_ADDRESS \
  --amount 1000000000

# Confirm payout (as agent)
soroban contract invoke \
  --id $SWIFTREMIT_CONTRACT_ID \
  --source agent \
  --network testnet \
  -- \
  confirm_payout \
  --remittance_id 1
```

### Frontend Test Flow

1. Open http://localhost:5173
2. Connect Freighter wallet
3. Create a remittance (100 USDC)
4. Switch to agent account
5. Confirm the payout
6. Verify balances updated

## 📊 Monitoring

### Check Contract Status
```bash
soroban contract invoke \
  --id $SWIFTREMIT_CONTRACT_ID \
  --source sender \
  --network testnet \
  -- \
  health
```

### Watch Events
```bash
soroban events --start-ledger latest --id $SWIFTREMIT_CONTRACT_ID --network testnet
```

### Check Balances
```bash
# USDC balance
soroban contract invoke \
  --id $USDC_TOKEN_ID \
  --source sender \
  --network testnet \
  -- \
  balance \
  --id $SENDER_ADDRESS
```

## 🆘 Troubleshooting

### Common Issues

**"Account not found"**
```bash
# Fund the account
curl "https://friendbot.stellar.org/?addr=YOUR_ADDRESS"
```

**"Contract not found"**
```bash
# Verify deployment
soroban contract info --id $SWIFTREMIT_CONTRACT_ID --network testnet
```

**"Insufficient balance"**
```bash
# Check XLM for fees
curl "https://horizon-testnet.stellar.org/accounts/YOUR_ADDRESS"
```

### Reset Everything
```bash
# Remove old identities
soroban keys rm sender
soroban keys rm agent
soroban keys rm deployer

# Run setup again
./setup-testnet.sh
```

## 📚 Documentation

- **[TESTNET_SETUP_GUIDE.md](TESTNET_SETUP_GUIDE.md)** - Complete setup guide
- **[README.md](README.md)** - Project overview and architecture
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Deployment instructions
- **[API.md](API.md)** - API documentation
- **[ASSET_VERIFICATION.md](ASSET_VERIFICATION.md)** - Asset verification system

## 🔗 Resources

- **Stellar Testnet Explorer**: https://stellar.expert/explorer/testnet
- **Friendbot**: https://friendbot.stellar.org/
- **Stellar Laboratory**: https://laboratory.stellar.org/
- **Freighter Wallet**: https://www.freighter.app/
- **Soroban Documentation**: https://soroban.stellar.org/

## 💡 Tips

- Keep your `.env.testnet.local` file secure (contains secret keys)
- Use different accounts for different roles (sender, agent, admin)
- Monitor the [Stellar Status Page](https://status.stellar.org/) for testnet issues
- Join the [Stellar Discord](https://discord.gg/stellar) for support

---

**Ready to build on Stellar? Start with `./setup-testnet.sh` and you'll be running remittances in minutes!** 🚀