# Asset Verification System - Setup Guide

Quick start guide for deploying and running the asset verification system.

## Docker Compose Quick-Start (Recommended)

The fastest way to get a full local environment running — no manual PostgreSQL setup required.

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose v2)

```bash
# 1. Clone the repo and enter the directory
git clone https://github.com/HaroldwonderSwiftRemit/SwiftRemit.git
cd SwiftRemit

# 2. (Optional) Create a local secrets override
cp docker-compose.override.yml docker-compose.override.local.yml
# Edit docker-compose.override.local.yml with real secrets

# 3. Start all services
docker compose up --build

# Services will be available at:
#   PostgreSQL  → localhost:5432
#   Backend     → http://localhost:3001
#   API         → http://localhost:3000
#   Frontend    → http://localhost:5173
```

Source files are volume-mounted so changes to `backend/src`, `api/src`, and `frontend/src` trigger hot-reload without rebuilding the image.

To stop and remove containers:
```bash
docker compose down
# Add -v to also remove the postgres_data volume (wipes the database)
docker compose down -v
```

---

## Manual Setup

Follow the steps below if you prefer to run services directly on your machine.

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+
- Rust and Cargo (for smart contract)
- Stellar CLI (soroban-cli)

## 1. Database Setup

```bash
# Install PostgreSQL (if not already installed)
# macOS: brew install postgresql
# Ubuntu: sudo apt-get install postgresql
# Windows: Download from postgresql.org

# Start PostgreSQL
# macOS: brew services start postgresql
# Ubuntu: sudo service postgresql start
# Windows: Start from Services

# Create database
psql -U postgres -c "CREATE DATABASE swiftremit;"
```

## 2. Backend Service Setup

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Edit .env with your settings:
# - DATABASE_URL: Your PostgreSQL connection string
# - CONTRACT_ID: Your deployed contract ID
# - ADMIN_SECRET_KEY: Admin Stellar secret key
# - HORIZON_URL: Stellar Horizon endpoint

# Run database migrations (automatic on first start)
npm run dev

# For production
npm run build
npm start
```

## 3. Smart Contract Deployment

```bash
# Build contract
cargo build --target wasm32-unknown-unknown --release
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/swiftremit.wasm

# Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/swiftremit.optimized.wasm \
  --source deployer \
  --network testnet

# Initialize contract
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- \
  initialize \
  --admin <ADMIN_ADDRESS> \
  --usdc_token <USDC_TOKEN_ADDRESS> \
  --fee_bps 250
```

## 4. Frontend Integration

```bash
cd frontend

# Install dependencies
npm install

# Use in your React app
import { VerificationBadge } from './components/VerificationBadge';

function App() {
  return (
    <VerificationBadge
      assetCode="USDC"
      issuer="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      apiUrl="http://localhost:3000"
    />
  );
}
```

## 5. Testing

```bash
# Test smart contract
cargo test

# Test backend
cd backend
npm test

# Test frontend
cd frontend
npm test
```

## 6. Verify Installation

```bash
# Check backend health
curl http://localhost:3000/health

# Verify an asset
curl -X POST http://localhost:3000/api/verification/verify \
  -H "Content-Type: application/json" \
  -d '{
    "assetCode": "USDC",
    "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
  }'

# Get verification status
curl http://localhost:3000/api/verification/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
```

## Environment Variables Reference

### Backend (.env)

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/swiftremit

# Stellar Network
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
CONTRACT_ID=CXXX...
ADMIN_SECRET_KEY=SXXX...

# API Server
PORT=3000
NODE_ENV=development

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Verification Settings
VERIFICATION_INTERVAL_HOURS=24
MIN_TRUSTLINE_COUNT=10
MIN_REPUTATION_SCORE=50
```

## Troubleshooting

### Database Connection Issues

```bash
# Check PostgreSQL is running
psql -U postgres -c "SELECT version();"

# Verify database exists
psql -U postgres -l | grep swiftremit

# Test connection
psql postgresql://user:password@localhost:5432/swiftremit
```

### Backend Service Issues

```bash
# Check logs
npm run dev

# Verify port is available
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Test API manually
curl http://localhost:3000/health
```

### Smart Contract Issues

```bash
# Verify contract is deployed
soroban contract info --id <CONTRACT_ID> --network testnet

# Check contract functions
soroban contract inspect --wasm target/wasm32-unknown-unknown/release/swiftremit.optimized.wasm
```

## Production Deployment

### Backend

```bash
# Use process manager (PM2)
npm install -g pm2
pm2 start npm --name "swiftremit-api" -- start
pm2 save
pm2 startup

# Or use Docker
docker build -t swiftremit-api .
docker run -p 3000:3000 --env-file .env swiftremit-api
```

### Database

```bash
# Enable SSL for production
DATABASE_URL=postgresql://user:password@host:5432/swiftremit?sslmode=require

# Set up backups
pg_dump swiftremit > backup.sql

# Restore from backup
psql swiftremit < backup.sql
```

### Monitoring

```bash
# Backend logs
pm2 logs swiftremit-api

# Database monitoring
psql swiftremit -c "SELECT * FROM pg_stat_activity;"

# API health check
curl http://your-domain.com/health
```

## Security Checklist

- [ ] Change default admin secret key
- [ ] Enable SSL for database connections
- [ ] Set up firewall rules
- [ ] Configure rate limiting
- [ ] Enable HTTPS for API
- [ ] Rotate secrets regularly
- [ ] Monitor for suspicious activity
- [ ] Set up automated backups
- [ ] Use environment variables (never commit secrets)
- [ ] Enable audit logging

## Support

For issues or questions:
- Check [ASSET_VERIFICATION.md](ASSET_VERIFICATION.md) for detailed documentation
- Review [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) for architecture details
- Open an issue on GitHub
- Join Stellar Discord: https://discord.gg/stellar

## Next Steps

1. Verify a few well-known assets (USDC, AQUA, etc.)
2. Monitor background job execution
3. Test frontend component in your app
4. Set up monitoring and alerts
5. Plan for mainnet deployment
