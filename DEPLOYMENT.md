# SwiftRemit Deployment Guide

## Frontend Deployment

### Quick Deploy to Vercel (Recommended)

#### Option 1: Deploy via Vercel Dashboard (Easiest)

1. **Go to Vercel**: https://vercel.com
2. **Sign in** with your GitHub account
3. **Import Project**:
   - Click "Add New..." → "Project"
   - Select your GitHub repository: `Haroldwonder/SwiftRemit`
   - Select branch: `refactor/production-readiness-soroban`
4. **Configure Project**:
   - Framework Preset: Vite
   - Root Directory: `frontend`
   - Build Command: `npm install --legacy-peer-deps && npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install --legacy-peer-deps`
5. **Environment Variables** (Add these in Vercel dashboard):
   ```
   VITE_NETWORK=testnet
   VITE_HORIZON_URL=https://horizon-testnet.stellar.org
   VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
   VITE_CONTRACT_ID=your_contract_id_here
   VITE_USDC_TOKEN_ID=your_usdc_token_id_here
   ```
6. **Deploy**: Click "Deploy"

Your site will be live at: `https://swiftremit-[random].vercel.app`

#### Option 2: Deploy via Vercel CLI

```bash
# Install Vercel CLI globally
npm install -g vercel

# Navigate to frontend directory
cd SwiftRemit/frontend

# Login to Vercel
vercel login

# Deploy
vercel

# Follow the prompts:
# - Set up and deploy? Yes
# - Which scope? Your account
# - Link to existing project? No
# - Project name? swiftremit-frontend
# - Directory? ./
# - Override settings? No

# Your deployment URL will be shown!
```

#### Option 3: Deploy via GitHub Integration

1. Push your code to GitHub (already done ✅)
2. Go to https://vercel.com/new
3. Import your repository
4. Vercel will auto-detect Vite and deploy

---

### Alternative: Deploy to Netlify

#### Via Netlify Dashboard

1. **Go to Netlify**: https://app.netlify.com
2. **Sign in** with GitHub
3. **Add new site** → "Import an existing project"
4. **Connect to Git provider**: GitHub
5. **Select repository**: `Haroldwonder/SwiftRemit`
6. **Configure**:
   - Branch: `refactor/production-readiness-soroban`
   - Base directory: `frontend`
   - Build command: `npm install --legacy-peer-deps && npm run build`
   - Publish directory: `frontend/dist`
7. **Environment variables**: Add the same as Vercel
8. **Deploy**

Your site will be live at: `https://swiftremit-[random].netlify.app`

#### Via Netlify CLI

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Navigate to frontend
cd SwiftRemit/frontend

# Login
netlify login

# Deploy
netlify deploy --prod

# Follow prompts and your site will be live!
```

---

### Alternative: GitHub Pages

1. **Enable GitHub Pages**:
   - Go to: https://github.com/Haroldwonder/SwiftRemit/settings/pages
   - Source: Deploy from a branch
   - Branch: `refactor/production-readiness-soroban`
   - Folder: `/frontend` (if available) or `/` (root)
   - Save

2. **Add GitHub Actions workflow** (if needed):
   Create `.github/workflows/deploy.yml`:
   ```yaml
   name: Deploy to GitHub Pages
   
   on:
     push:
       branches: [refactor/production-readiness-soroban]
   
   jobs:
     build-and-deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3
         - uses: actions/setup-node@v3
           with:
             node-version: '18'
         - name: Install and Build
           run: |
             cd frontend
             npm install --legacy-peer-deps
             npm run build
         - name: Deploy
           uses: peaceiris/actions-gh-pages@v3
           with:
             github_token: ${{ secrets.GITHUB_TOKEN }}
             publish_dir: ./frontend/dist
   ```

Your site will be at: `https://haroldwonder.github.io/SwiftRemit/`

---

## Smart Contract Deployment

### Prerequisites

1. **Install Stellar CLI**:
   ```bash
   cargo install --locked stellar-cli
   ```

2. **Create Testnet Identity**:
   ```bash
   stellar keys generate --global admin --network testnet
   stellar keys address admin
   ```

3. **Fund Account**:
   - Go to: https://laboratory.stellar.org/#account-creator?network=test
   - Paste your address and click "Get test network lumens"

### Deploy Contract

```bash
# Navigate to contract directory
cd SwiftRemit

# Build the contract
stellar contract build

# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/swiftremit.wasm \
  --source admin \
  --network testnet

# Save the contract ID that's returned!
```

### Initialize Contract

```bash
# Set variables
CONTRACT_ID="your_contract_id_here"
ADMIN_ADDRESS="your_admin_address_here"
USDC_TOKEN="USDC_testnet_token_id"

# Initialize
stellar contract invoke \
  --id $CONTRACT_ID \
  --source admin \
  --network testnet \
  -- \
  initialize \
  --admin $ADMIN_ADDRESS \
  --usdc_token $USDC_TOKEN \
  --fee_bps 250 \
  --rate_limit_cooldown 5 \
  --protocol_fee_bps 50 \
  --treasury $ADMIN_ADDRESS
```

### Update Frontend Environment Variables

After deploying the contract, update your frontend `.env` or Vercel environment variables:

```env
VITE_CONTRACT_ID=your_actual_contract_id
VITE_USDC_TOKEN_ID=your_actual_usdc_token_id
```

Then redeploy the frontend.

---

## Post-Deployment Checklist

### Frontend
- [ ] Site is accessible via public URL
- [ ] Wallet connection works (Freighter)
- [ ] Can view remittances
- [ ] Forms render correctly
- [ ] No console errors

### Smart Contract
- [ ] Contract deployed to testnet
- [ ] Contract initialized successfully
- [ ] Admin can register agents
- [ ] Can create remittances
- [ ] Can confirm payouts
- [ ] Events are emitted correctly

---

## Monitoring & Maintenance

### Frontend Monitoring
- **Vercel**: Built-in analytics at https://vercel.com/dashboard
- **Netlify**: Analytics at https://app.netlify.com

### Contract Monitoring
- **Stellar Expert**: https://stellar.expert/explorer/testnet
- **Horizon API**: https://horizon-testnet.stellar.org

### Contract Function Examples

#### Get Settlement Hash

Retrieve the stored settlement hash for a settled remittance:

```bash
# Get settlement hash for a remittance
stellar contract invoke \
  --id $CONTRACT_ID \
  --network testnet \
  -- \
  get_settlement_hash \
  --remittance_id 1
```

This function returns the 32-byte SHA-256 settlement hash that was stored when the remittance was settled. External systems can use this to verify their computed hash matches the on-chain value.

**Example Response:**
```
"a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd"
```

**Error Cases:**
- `RemittanceNotFound`: The remittance ID doesn't exist
- `InvalidStatus`: The remittance hasn't been settled yet

#### Compute Settlement Hash

Compute the deterministic settlement hash for any remittance (settled or not):

```bash
# Compute settlement hash for a remittance
stellar contract invoke \
  --id $CONTRACT_ID \
  --network testnet \
  -- \
  compute_settlement_hash \
  --remittance_id 1
```

This function computes the hash using the canonical ordering specified in the contract. External systems can use this to pre-compute hashes before settlement or verify their hashing implementation matches the contract's.

**Use Cases:**
- Pre-compute settlement IDs before submission
- Verify external system hashing matches contract implementation
- Enable cross-system reconciliation using deterministic IDs

### Logs
- **Frontend**: Check Vercel/Netlify deployment logs
- **Contract**: Use Stellar CLI to query contract state

---

## Troubleshooting

### Frontend Build Fails
```bash
# Clear cache and reinstall
cd frontend
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
npm run build
```

### Contract Deployment Fails
```bash
# Check account balance
stellar account --id admin

# Rebuild contract
cargo clean
stellar contract build
```

### Environment Variables Not Working
- Ensure variables start with `VITE_` prefix
- Redeploy after changing variables
- Check browser console for actual values

---

## Storage TTL Management

Soroban contracts use two storage tiers with different TTL behaviours:

| Storage type | Scope | Default TTL | Risk if expired |
|---|---|---|---|
| **Instance** | Contract-wide config (admin, fee, counters) | ~1 month | Contract becomes unusable |
| **Persistent** | Per-entity data (remittances, agents, limits) | ~1 month | Individual records lost |
| **Temporary** | Rate-limit windows, sliding windows | Short (hours) | Resets automatically — acceptable |

### Key audit

| Key | Storage | TTL strategy |
|---|---|---|
| `Admin`, `UsdcToken`, `PlatformFeeBps`, `RemittanceCounter`, `AccumulatedFees` | Instance | Extended by `extend_storage_ttl` |
| `Remittance(id)` | Persistent | Extended by `extend_storage_ttl` for all IDs up to counter |
| `AgentRegistered(addr)` | Persistent | Extended by `extend_storage_ttl` |
| `DailyLimit(currency, country)` | Persistent | Extended by `extend_storage_ttl` |
| `RateLimitEntry(addr)` | Temporary | Self-managed (TTL = window + 1 h) |
| `SlidingWindowEntry(addr, tag)` | Temporary | Self-managed (TTL = 2 × window) |

### Extending TTLs manually

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source admin \
  --network testnet \
  -- \
  extend_storage_ttl \
  --caller $ADMIN_ADDRESS \
  --extend_by_ledgers 518400
```

`518400` ledgers ≈ 30 days at 5-second ledger time.

### Automated TTL extension (backend scheduler)

The backend scheduler runs `extendContractStorageTtl()` daily at midnight UTC.
Configure the following environment variables in `backend/.env`:

```env
CONTRACT_ID=your_contract_id
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
ADMIN_SECRET_KEY=your_admin_secret_key
```

The job extends TTLs by **518 400 ledgers (~30 days)** each run, providing a
comfortable buffer before the next scheduled execution.

---

## Support

- **Documentation**: See README.md files in each directory
- **Issues**: https://github.com/Haroldwonder/SwiftRemit/issues
- **Stellar Discord**: https://discord.gg/stellar

---

## Quick Links

- **Repository**: https://github.com/Haroldwonder/SwiftRemit
- **Branch**: refactor/production-readiness-soroban
- **Stellar Testnet**: https://horizon-testnet.stellar.org
- **Freighter Wallet**: https://www.freighter.app/
