#!/bin/bash
set -e

# SwiftRemit Testnet Setup Script
# Automates the complete testnet setup process

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NETWORK=${NETWORK:-testnet}
SENDER_IDENTITY=${SENDER_IDENTITY:-sender}
AGENT_IDENTITY=${AGENT_IDENTITY:-agent}
DEPLOYER_IDENTITY=${DEPLOYER_IDENTITY:-deployer}

echo -e "${BLUE}🚀 SwiftRemit Testnet Setup Script${NC}"
echo "=================================="
echo ""

# Function to print status
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v soroban &> /dev/null; then
    print_error "Soroban CLI not found. Please install it first:"
    echo "  cargo install --locked soroban-cli"
    exit 1
fi

if ! command -v cargo &> /dev/null; then
    print_error "Cargo not found. Please install Rust first:"
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

if ! command -v curl &> /dev/null; then
    print_error "curl not found. Please install curl first."
    exit 1
fi

print_status "Prerequisites check passed"
echo ""

# Step 1: Generate accounts
echo "Step 1: Generating test accounts..."

# Generate sender account
if ! soroban keys address $SENDER_IDENTITY &> /dev/null; then
    print_info "Generating sender account..."
    soroban keys generate --global $SENDER_IDENTITY --network $NETWORK
    print_status "Sender account generated"
else
    print_info "Sender account already exists"
fi

# Generate agent account
if ! soroban keys address $AGENT_IDENTITY &> /dev/null; then
    print_info "Generating agent account..."
    soroban keys generate --global $AGENT_IDENTITY --network $NETWORK
    print_status "Agent account generated"
else
    print_info "Agent account already exists"
fi

# Generate deployer account
if ! soroban keys address $DEPLOYER_IDENTITY &> /dev/null; then
    print_info "Generating deployer account..."
    soroban keys generate --global $DEPLOYER_IDENTITY --network $NETWORK
    print_status "Deployer account generated"
else
    print_info "Deployer account already exists"
fi

# Get addresses
SENDER_ADDRESS=$(soroban keys address $SENDER_IDENTITY)
AGENT_ADDRESS=$(soroban keys address $AGENT_IDENTITY)
DEPLOYER_ADDRESS=$(soroban keys address $DEPLOYER_IDENTITY)

echo ""
echo "Generated Accounts:"
echo "  Sender:   $SENDER_ADDRESS"
echo "  Agent:    $AGENT_ADDRESS"
echo "  Deployer: $DEPLOYER_ADDRESS"
echo ""

# Step 2: Fund accounts with XLM
echo "Step 2: Funding accounts with testnet XLM..."

fund_account() {
    local address=$1
    local name=$2
    
    print_info "Funding $name account..."
    
    # Try funding via Friendbot
    if curl -s "https://friendbot.stellar.org/?addr=$address" > /dev/null; then
        print_status "$name account funded via Friendbot"
    else
        print_warning "Friendbot funding failed for $name, trying Soroban CLI..."
        if soroban keys fund $name --network $NETWORK; then
            print_status "$name account funded via Soroban CLI"
        else
            print_error "Failed to fund $name account"
            return 1
        fi
    fi
    
    # Wait a moment for funding to propagate
    sleep 2
}

fund_account $SENDER_ADDRESS "sender"
fund_account $AGENT_ADDRESS "agent"
fund_account $DEPLOYER_ADDRESS "deployer"

echo ""

# Step 3: Verify balances
echo "Step 3: Verifying XLM balances..."

check_balance() {
    local address=$1
    local name=$2
    
    # Query balance via Horizon API
    local balance=$(curl -s "https://horizon-testnet.stellar.org/accounts/$address" | \
                   grep -o '"balance":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "0")
    
    if (( $(echo "$balance > 1000" | bc -l) )); then
        print_status "$name balance: $balance XLM"
    else
        print_warning "$name balance: $balance XLM (may be low)"
    fi
}

# Install bc for balance comparison if not available
if ! command -v bc &> /dev/null; then
    print_info "Installing bc for balance calculations..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y bc
    elif command -v yum &> /dev/null; then
        sudo yum install -y bc
    elif command -v brew &> /dev/null; then
        brew install bc
    else
        print_warning "Could not install bc, skipping balance verification"
    fi
fi

if command -v bc &> /dev/null; then
    check_balance $SENDER_ADDRESS "Sender"
    check_balance $AGENT_ADDRESS "Agent"
    check_balance $DEPLOYER_ADDRESS "Deployer"
else
    print_info "Skipping balance verification (bc not available)"
fi

echo ""

# Step 4: Build and deploy contract
echo "Step 4: Building and deploying SwiftRemit contract..."

# Check if we're in the right directory
if [ ! -f "Cargo.toml" ]; then
    print_error "Cargo.toml not found. Please run this script from the SwiftRemit root directory."
    exit 1
fi

# Build contract
print_info "Building contract..."
cargo build --target wasm32-unknown-unknown --release

if [ ! -f "target/wasm32-unknown-unknown/release/swiftremit.wasm" ]; then
    print_error "Contract build failed"
    exit 1
fi

# Optimize contract
print_info "Optimizing contract..."
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/swiftremit.wasm

# Deploy contract
print_info "Deploying SwiftRemit contract..."
CONTRACT_ID=$(soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/swiftremit.optimized.wasm \
  --source $DEPLOYER_IDENTITY \
  --network $NETWORK)

print_status "Contract deployed: $CONTRACT_ID"

# Deploy mock USDC token
print_info "Deploying mock USDC token..."
USDC_ID=$(soroban contract asset deploy \
  --asset "USDC:$DEPLOYER_ADDRESS" \
  --source $DEPLOYER_IDENTITY \
  --network $NETWORK)

print_status "USDC token deployed: $USDC_ID"

# Initialize contract
print_info "Initializing contract..."
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $DEPLOYER_IDENTITY \
  --network $NETWORK \
  -- \
  initialize \
  --admin $DEPLOYER_ADDRESS \
  --usdc_token $USDC_ID \
  --fee_bps 250

print_status "Contract initialized"

echo ""

# Step 5: Register agent
echo "Step 5: Registering agent..."

soroban contract invoke \
  --id $CONTRACT_ID \
  --source $DEPLOYER_IDENTITY \
  --network $NETWORK \
  -- \
  register_agent \
  --agent $AGENT_ADDRESS

print_status "Agent registered: $AGENT_ADDRESS"

echo ""

# Step 6: Mint USDC to sender
echo "Step 6: Minting USDC tokens to sender..."

# Mint 10,000 USDC to sender (10,000 * 10^7 stroops)
soroban contract invoke \
  --id $USDC_ID \
  --source $DEPLOYER_IDENTITY \
  --network $NETWORK \
  -- \
  mint \
  --to $SENDER_ADDRESS \
  --amount 100000000000

print_status "Minted 10,000 USDC to sender"

# Verify USDC balance
USDC_BALANCE=$(soroban contract invoke \
  --id $USDC_ID \
  --source $SENDER_IDENTITY \
  --network $NETWORK \
  -- \
  balance \
  --id $SENDER_ADDRESS)

print_status "Sender USDC balance: $USDC_BALANCE stroops"

echo ""

# Step 7: Save configuration
echo "Step 7: Saving configuration..."

# Create .env.local file
cat > .env.local << EOF
# SwiftRemit Testnet Configuration
# Generated by setup-testnet.sh on $(date)

# Network
NETWORK=$NETWORK
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org:443
HORIZON_URL=https://horizon-testnet.stellar.org

# Contract IDs
SWIFTREMIT_CONTRACT_ID=$CONTRACT_ID
USDC_TOKEN_ID=$USDC_ID

# Frontend configuration
NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID
NEXT_PUBLIC_USDC_TOKEN_ADDRESS=$USDC_ID
VITE_CONTRACT_ID=$CONTRACT_ID
VITE_USDC_TOKEN_ID=$USDC_ID

# Account addresses
SENDER_ADDRESS=$SENDER_ADDRESS
AGENT_ADDRESS=$AGENT_ADDRESS
DEPLOYER_ADDRESS=$DEPLOYER_ADDRESS

# Account identities (for Soroban CLI)
SENDER_IDENTITY=$SENDER_IDENTITY
AGENT_IDENTITY=$AGENT_IDENTITY
DEPLOYER_IDENTITY=$DEPLOYER_IDENTITY
EOF

print_status "Configuration saved to .env.local"

# Create testnet integration test config
cat > .env.testnet.local << EOF
# SwiftRemit Testnet Integration Test Configuration
# Generated by setup-testnet.sh on $(date)

NETWORK=$NETWORK
HORIZON_URL=https://horizon-testnet.stellar.org
RPC_URL=https://soroban-testnet.stellar.org:443
FRIENDBOT_URL=https://friendbot.stellar.org

SWIFTREMIT_CONTRACT_ID=$CONTRACT_ID
USDC_TOKEN_ID=$USDC_ID

# Test account secrets (WARNING: Testnet only!)
TESTNET_ADMIN_SECRET=$(soroban keys show $DEPLOYER_IDENTITY)
TESTNET_ADMIN_PUBLIC=$DEPLOYER_ADDRESS

TESTNET_AGENT_SECRET=$(soroban keys show $AGENT_IDENTITY)
TESTNET_AGENT_PUBLIC=$AGENT_ADDRESS

TESTNET_SENDER_SECRET=$(soroban keys show $SENDER_IDENTITY)
TESTNET_SENDER_PUBLIC=$SENDER_ADDRESS

# Test configuration
DEFAULT_FEE_BPS=250
TEST_REMITTANCE_AMOUNT=1000000000
TRANSACTION_TIMEOUT=30
POLL_INTERVAL_MS=2000
MAX_POLL_RETRIES=15
EOF

print_status "Test configuration saved to .env.testnet.local"

echo ""

# Step 8: Test the setup
echo "Step 8: Testing the setup..."

print_info "Creating a test remittance..."

# Approve USDC transfer
soroban contract invoke \
  --id $USDC_ID \
  --source $SENDER_IDENTITY \
  --network $NETWORK \
  -- \
  approve \
  --from $SENDER_ADDRESS \
  --spender $CONTRACT_ID \
  --amount 1000000000

# Create test remittance (100 USDC)
REMITTANCE_ID=$(soroban contract invoke \
  --id $CONTRACT_ID \
  --source $SENDER_IDENTITY \
  --network $NETWORK \
  -- \
  create_remittance \
  --sender $SENDER_ADDRESS \
  --agent $AGENT_ADDRESS \
  --amount 1000000000)

print_status "Test remittance created: $REMITTANCE_ID"

# Confirm payout as agent
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $AGENT_IDENTITY \
  --network $NETWORK \
  -- \
  confirm_payout \
  --remittance_id $REMITTANCE_ID

print_status "Test remittance completed successfully"

# Check final balances
SENDER_FINAL_BALANCE=$(soroban contract invoke \
  --id $USDC_ID \
  --source $SENDER_IDENTITY \
  --network $NETWORK \
  -- \
  balance \
  --id $SENDER_ADDRESS)

AGENT_FINAL_BALANCE=$(soroban contract invoke \
  --id $USDC_ID \
  --source $AGENT_IDENTITY \
  --network $NETWORK \
  -- \
  balance \
  --id $AGENT_ADDRESS)

echo ""
echo "Final USDC Balances:"
echo "  Sender: $SENDER_FINAL_BALANCE stroops"
echo "  Agent:  $AGENT_FINAL_BALANCE stroops"

echo ""
echo -e "${GREEN}🎉 Setup Complete!${NC}"
echo "=================================="
echo ""
echo "Your SwiftRemit testnet environment is ready:"
echo ""
echo -e "${BLUE}Contract Information:${NC}"
echo "  SwiftRemit Contract: $CONTRACT_ID"
echo "  USDC Token:          $USDC_ID"
echo "  Network:             $NETWORK"
echo ""
echo -e "${BLUE}Account Information:${NC}"
echo "  Sender:   $SENDER_ADDRESS"
echo "  Agent:    $AGENT_ADDRESS"
echo "  Deployer: $DEPLOYER_ADDRESS"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "1. Set up Freighter wallet with these accounts"
echo "2. Start the frontend: cd frontend && npm run dev"
echo "3. Run integration tests: cargo test --features testnet-integration"
echo "4. Check the full guide: TESTNET_SETUP_GUIDE.md"
echo ""
echo -e "${BLUE}Configuration Files Created:${NC}"
echo "  .env.local           - General configuration"
echo "  .env.testnet.local   - Integration test configuration"
echo ""
echo -e "${YELLOW}Important:${NC} Keep your secret keys secure and never commit .env.testnet.local to git!"