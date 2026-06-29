# SwiftRemit Testnet Setup Script (PowerShell)
# Automates the complete testnet setup process

param(
    [string]$Network = "testnet",
    [string]$SenderIdentity = "sender",
    [string]$AgentIdentity = "agent", 
    [string]$DeployerIdentity = "deployer"
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-Success { param($Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Write-Warning { param($Message) Write-Host "⚠️  $Message" -ForegroundColor Yellow }
function Write-Error { param($Message) Write-Host "❌ $Message" -ForegroundColor Red }
function Write-Info { param($Message) Write-Host "ℹ️  $Message" -ForegroundColor Blue }

Write-Host "🚀 SwiftRemit Testnet Setup Script" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Gray
Write-Host ""

# Check prerequisites
Write-Host "Checking prerequisites..." -ForegroundColor Yellow

if (-not (Get-Command soroban -ErrorAction SilentlyContinue)) {
    Write-Error "Soroban CLI not found. Please install it first:"
    Write-Host "  cargo install --locked soroban-cli"
    exit 1
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "Cargo not found. Please install Rust first:"
    Write-Host "  https://rustup.rs/"
    exit 1
}

if (-not (Get-Command curl -ErrorAction SilentlyContinue)) {
    Write-Error "curl not found. Please install curl first."
    exit 1
}

Write-Success "Prerequisites check passed"
Write-Host ""

# Step 1: Generate accounts
Write-Host "Step 1: Generating test accounts..." -ForegroundColor Yellow

# Generate sender account
try {
    $null = soroban keys address $SenderIdentity 2>$null
    Write-Info "Sender account already exists"
} catch {
    Write-Info "Generating sender account..."
    soroban keys generate --global $SenderIdentity --network $Network
    Write-Success "Sender account generated"
}

# Generate agent account
try {
    $null = soroban keys address $AgentIdentity 2>$null
    Write-Info "Agent account already exists"
} catch {
    Write-Info "Generating agent account..."
    soroban keys generate --global $AgentIdentity --network $Network
    Write-Success "Agent account generated"
}

# Generate deployer account
try {
    $null = soroban keys address $DeployerIdentity 2>$null
    Write-Info "Deployer account already exists"
} catch {
    Write-Info "Generating deployer account..."
    soroban keys generate --global $DeployerIdentity --network $Network
    Write-Success "Deployer account generated"
}

# Get addresses
$SenderAddress = soroban keys address $SenderIdentity
$AgentAddress = soroban keys address $AgentIdentity
$DeployerAddress = soroban keys address $DeployerIdentity

Write-Host ""
Write-Host "Generated Accounts:" -ForegroundColor Gray
Write-Host "  Sender:   $SenderAddress"
Write-Host "  Agent:    $AgentAddress"
Write-Host "  Deployer: $DeployerAddress"
Write-Host ""

# Step 2: Fund accounts with XLM
Write-Host "Step 2: Funding accounts with testnet XLM..." -ForegroundColor Yellow

function Fund-Account {
    param($Address, $Name)
    
    Write-Info "Funding $Name account..."
    
    try {
        $response = Invoke-RestMethod -Uri "https://friendbot.stellar.org/?addr=$Address" -Method Get
        Write-Success "$Name account funded via Friendbot"
    } catch {
        Write-Warning "Friendbot funding failed for $Name, trying Soroban CLI..."
        try {
            soroban keys fund $Name --network $Network
            Write-Success "$Name account funded via Soroban CLI"
        } catch {
            Write-Error "Failed to fund $Name account"
            throw
        }
    }
    
    # Wait a moment for funding to propagate
    Start-Sleep -Seconds 2
}

Fund-Account $SenderAddress "sender"
Fund-Account $AgentAddress "agent"
Fund-Account $DeployerAddress "deployer"

Write-Host ""

# Step 3: Verify balances
Write-Host "Step 3: Verifying XLM balances..." -ForegroundColor Yellow

function Check-Balance {
    param($Address, $Name)
    
    try {
        $account = Invoke-RestMethod -Uri "https://horizon-testnet.stellar.org/accounts/$Address"
        $xlmBalance = ($account.balances | Where-Object { $_.asset_type -eq "native" }).balance
        
        if ([decimal]$xlmBalance -gt 1000) {
            Write-Success "$Name balance: $xlmBalance XLM"
        } else {
            Write-Warning "$Name balance: $xlmBalance XLM (may be low)"
        }
    } catch {
        Write-Warning "Could not verify $Name balance"
    }
}

Check-Balance $SenderAddress "Sender"
Check-Balance $AgentAddress "Agent"
Check-Balance $DeployerAddress "Deployer"

Write-Host ""

# Step 4: Build and deploy contract
Write-Host "Step 4: Building and deploying SwiftRemit contract..." -ForegroundColor Yellow

# Check if we're in the right directory
if (-not (Test-Path "Cargo.toml")) {
    Write-Error "Cargo.toml not found. Please run this script from the SwiftRemit root directory."
    exit 1
}

# Build contract
Write-Info "Building contract..."
cargo build --target wasm32-unknown-unknown --release

if (-not (Test-Path "target/wasm32-unknown-unknown/release/swiftremit.wasm")) {
    Write-Error "Contract build failed"
    exit 1
}

# Optimize contract
Write-Info "Optimizing contract..."
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/swiftremit.wasm

# Deploy contract
Write-Info "Deploying SwiftRemit contract..."
$ContractId = soroban contract deploy `
  --wasm target/wasm32-unknown-unknown/release/swiftremit.optimized.wasm `
  --source $DeployerIdentity `
  --network $Network

Write-Success "Contract deployed: $ContractId"

# Deploy mock USDC token
Write-Info "Deploying mock USDC token..."
$UsdcId = soroban contract asset deploy `
  --asset "USDC:$DeployerAddress" `
  --source $DeployerIdentity `
  --network $Network

Write-Success "USDC token deployed: $UsdcId"

# Initialize contract
Write-Info "Initializing contract..."
soroban contract invoke `
  --id $ContractId `
  --source $DeployerIdentity `
  --network $Network `
  -- `
  initialize `
  --admin $DeployerAddress `
  --usdc_token $UsdcId `
  --fee_bps 250

Write-Success "Contract initialized"

Write-Host ""

# Step 5: Register agent
Write-Host "Step 5: Registering agent..." -ForegroundColor Yellow

soroban contract invoke `
  --id $ContractId `
  --source $DeployerIdentity `
  --network $Network `
  -- `
  register_agent `
  --agent $AgentAddress

Write-Success "Agent registered: $AgentAddress"

Write-Host ""

# Step 6: Mint USDC to sender
Write-Host "Step 6: Minting USDC tokens to sender..." -ForegroundColor Yellow

# Mint 10,000 USDC to sender (10,000 * 10^7 stroops)
soroban contract invoke `
  --id $UsdcId `
  --source $DeployerIdentity `
  --network $Network `
  -- `
  mint `
  --to $SenderAddress `
  --amount 100000000000

Write-Success "Minted 10,000 USDC to sender"

# Verify USDC balance
$UsdcBalance = soroban contract invoke `
  --id $UsdcId `
  --source $SenderIdentity `
  --network $Network `
  -- `
  balance `
  --id $SenderAddress

Write-Success "Sender USDC balance: $UsdcBalance stroops"

Write-Host ""

# Step 7: Save configuration
Write-Host "Step 7: Saving configuration..." -ForegroundColor Yellow

# Create .env.local file
$EnvContent = @"
# SwiftRemit Testnet Configuration
# Generated by setup-testnet.ps1 on $(Get-Date)

# Network
NETWORK=$Network
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org:443
HORIZON_URL=https://horizon-testnet.stellar.org

# Contract IDs
SWIFTREMIT_CONTRACT_ID=$ContractId
USDC_TOKEN_ID=$UsdcId

# Frontend configuration
NEXT_PUBLIC_CONTRACT_ID=$ContractId
NEXT_PUBLIC_USDC_TOKEN_ADDRESS=$UsdcId
VITE_CONTRACT_ID=$ContractId
VITE_USDC_TOKEN_ID=$UsdcId

# Account addresses
SENDER_ADDRESS=$SenderAddress
AGENT_ADDRESS=$AgentAddress
DEPLOYER_ADDRESS=$DeployerAddress

# Account identities (for Soroban CLI)
SENDER_IDENTITY=$SenderIdentity
AGENT_IDENTITY=$AgentIdentity
DEPLOYER_IDENTITY=$DeployerIdentity
"@

Set-Content -Path ".env.local" -Value $EnvContent
Write-Success "Configuration saved to .env.local"

# Create testnet integration test config
$TestEnvContent = @"
# SwiftRemit Testnet Integration Test Configuration
# Generated by setup-testnet.ps1 on $(Get-Date)

NETWORK=$Network
HORIZON_URL=https://horizon-testnet.stellar.org
RPC_URL=https://soroban-testnet.stellar.org:443
FRIENDBOT_URL=https://friendbot.stellar.org

SWIFTREMIT_CONTRACT_ID=$ContractId
USDC_TOKEN_ID=$UsdcId

# Test account secrets (WARNING: Testnet only!)
TESTNET_ADMIN_SECRET=$(soroban keys show $DeployerIdentity)
TESTNET_ADMIN_PUBLIC=$DeployerAddress

TESTNET_AGENT_SECRET=$(soroban keys show $AgentIdentity)
TESTNET_AGENT_PUBLIC=$AgentAddress

TESTNET_SENDER_SECRET=$(soroban keys show $SenderIdentity)
TESTNET_SENDER_PUBLIC=$SenderAddress

# Test configuration
DEFAULT_FEE_BPS=250
TEST_REMITTANCE_AMOUNT=1000000000
TRANSACTION_TIMEOUT=30
POLL_INTERVAL_MS=2000
MAX_POLL_RETRIES=15
"@

Set-Content -Path ".env.testnet.local" -Value $TestEnvContent
Write-Success "Test configuration saved to .env.testnet.local"

Write-Host ""

# Step 8: Test the setup
Write-Host "Step 8: Testing the setup..." -ForegroundColor Yellow

Write-Info "Creating a test remittance..."

# Approve USDC transfer
soroban contract invoke `
  --id $UsdcId `
  --source $SenderIdentity `
  --network $Network `
  -- `
  approve `
  --from $SenderAddress `
  --spender $ContractId `
  --amount 1000000000

# Create test remittance (100 USDC)
$RemittanceId = soroban contract invoke `
  --id $ContractId `
  --source $SenderIdentity `
  --network $Network `
  -- `
  create_remittance `
  --sender $SenderAddress `
  --agent $AgentAddress `
  --amount 1000000000

Write-Success "Test remittance created: $RemittanceId"

# Confirm payout as agent
soroban contract invoke `
  --id $ContractId `
  --source $AgentIdentity `
  --network $Network `
  -- `
  confirm_payout `
  --remittance_id $RemittanceId

Write-Success "Test remittance completed successfully"

# Check final balances
$SenderFinalBalance = soroban contract invoke `
  --id $UsdcId `
  --source $SenderIdentity `
  --network $Network `
  -- `
  balance `
  --id $SenderAddress

$AgentFinalBalance = soroban contract invoke `
  --id $UsdcId `
  --source $AgentIdentity `
  --network $Network `
  -- `
  balance `
  --id $AgentAddress

Write-Host ""
Write-Host "Final USDC Balances:" -ForegroundColor Gray
Write-Host "  Sender: $SenderFinalBalance stroops"
Write-Host "  Agent:  $AgentFinalBalance stroops"

Write-Host ""
Write-Host "🎉 Setup Complete!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Gray
Write-Host ""
Write-Host "Your SwiftRemit testnet environment is ready:" -ForegroundColor Gray
Write-Host ""
Write-Host "Contract Information:" -ForegroundColor Blue
Write-Host "  SwiftRemit Contract: $ContractId"
Write-Host "  USDC Token:          $UsdcId"
Write-Host "  Network:             $Network"
Write-Host ""
Write-Host "Account Information:" -ForegroundColor Blue
Write-Host "  Sender:   $SenderAddress"
Write-Host "  Agent:    $AgentAddress"
Write-Host "  Deployer: $DeployerAddress"
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Blue
Write-Host "1. Set up Freighter wallet with these accounts"
Write-Host "2. Start the frontend: cd frontend && npm run dev"
Write-Host "3. Run integration tests: cargo test --features testnet-integration"
Write-Host "4. Check the full guide: TESTNET_SETUP_GUIDE.md"
Write-Host ""
Write-Host "Configuration Files Created:" -ForegroundColor Blue
Write-Host "  .env.local           - General configuration"
Write-Host "  .env.testnet.local   - Integration test configuration"
Write-Host ""
Write-Host "Important:" -ForegroundColor Yellow -NoNewline
Write-Host " Keep your secret keys secure and never commit .env.testnet.local to git!"