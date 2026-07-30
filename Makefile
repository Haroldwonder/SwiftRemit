.PHONY: build test clean deploy install optimize check fmt setup check-licenses helm-lint

# Default target
all: build test

# Create the per-service .env files the Docker Compose stack reads (SR-102).
# Copies each .env.example template to a gitignored .env when absent and fills
# in working local values. Never overwrites an existing .env.
setup:
	@./scripts/setup-env.sh

# Verify the LICENSE file, every package manifest, and all dependency licences
# (SR-101).
check-licenses:
	@node scripts/check-manifest-licenses.js
	@node scripts/check-dependency-licenses.js

# Lint and render the Helm chart against every environment's values (SR-103).
helm-lint:
	@./scripts/helm-validate.sh

# Install dependencies
install:
	@echo "Installing dependencies..."
	rustup target add wasm32-unknown-unknown
	cargo install --locked soroban-cli --features opt || true
	@echo "✅ Dependencies installed"

# Build the contract
build:
	@echo "Building contract..."
	cargo build --target wasm32-unknown-unknown --release
	@echo "✅ Build complete"

# Optimize the WASM binary
optimize: build
	@echo "Optimizing contract..."
	soroban contract optimize --wasm target/wasm32-unknown-unknown/release/swiftremit.wasm
	@echo "✅ Optimization complete"

# Run tests
test:
	@echo "Running tests..."
	cargo test
	@echo "✅ Tests passed"

# Run tests with output
test-verbose:
	@echo "Running tests with verbose output..."
	cargo test -- --nocapture
	@echo "✅ Tests passed"

# Check code without building
check:
	@echo "Checking code..."
	cargo check --target wasm32-unknown-unknown
	@echo "✅ Check complete"

# Format code
fmt:
	@echo "Formatting code..."
	cargo fmt
	@echo "✅ Code formatted"

# Lint code
lint:
	@echo "Linting code..."
	cargo clippy --target wasm32-unknown-unknown -- -D warnings
	@echo "✅ Lint complete"

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	cargo clean
	rm -f *.wasm *.optimized.wasm
	@echo "✅ Clean complete"

# Setup testnet network
setup-testnet:
	@echo "Setting up testnet..."
	soroban network add --global testnet \
		--rpc-url https://soroban-testnet.stellar.org:443 \
		--network-passphrase "Test SDF Network ; September 2015" || true
	@echo "✅ Testnet configured"

# Create deployer identity
create-identity:
	@echo "Creating deployer identity..."
	soroban keys generate --global deployer --network testnet || true
	@echo "Deployer address: $$(soroban keys address deployer)"
	@echo "✅ Identity created"

# Fund deployer account
fund-deployer:
	@echo "Funding deployer account..."
	soroban keys fund deployer --network testnet
	@echo "✅ Account funded"

# Deploy contract to testnet
deploy: optimize
	@echo "Deploying contract to testnet..."
	@CONTRACT_ID=$$(soroban contract deploy \
		--wasm target/wasm32-unknown-unknown/release/swiftremit.optimized.wasm \
		--source deployer \
		--network testnet); \
	echo "Contract deployed at: $$CONTRACT_ID"; \
	echo "$$CONTRACT_ID" > .contract-id
	@echo "✅ Deployment complete"

# Initialize contract (requires CONTRACT_ID, USDC_TOKEN, FEE_BPS env vars)
initialize:
	@if [ -z "$(CONTRACT_ID)" ]; then \
		echo "❌ CONTRACT_ID not set"; \
		exit 1; \
	fi
	@if [ -z "$(USDC_TOKEN)" ]; then \
		echo "❌ USDC_TOKEN not set"; \
		exit 1; \
	fi
	@echo "Initializing contract..."
	soroban contract invoke \
		--id $(CONTRACT_ID) \
		--source deployer \
		--network testnet \
		-- \
		initialize \
		--admin $$(soroban keys address deployer) \
		--usdc_token $(USDC_TOKEN) \
		--fee_bps $(or $(FEE_BPS),250)
	@echo "✅ Contract initialized"

# Full deployment flow
deploy-full: setup-testnet create-identity fund-deployer deploy
	@echo "✅ Full deployment complete"
	@echo "Contract ID saved to .contract-id"

# Watch for file changes and rebuild
watch:
	@echo "Watching for changes..."
	cargo watch -x 'build --target wasm32-unknown-unknown --release'

# Generate documentation
docs:
	@echo "Generating documentation..."
	cargo doc --no-deps --open
	@echo "✅ Documentation generated"

# Run security audit
audit:
	@echo "Running security audit..."
	cargo audit
	@echo "✅ Audit complete"

# Show contract size
size: optimize
	@echo "Contract size:"
	@ls -lh target/wasm32-unknown-unknown/release/swiftremit.optimized.wasm | awk '{print $$5}'

# Help
help:
	@echo "SwiftRemit Makefile Commands:"
	@echo ""
	@echo "Development:"
	@echo "  make setup          - Create per-service .env files for docker compose"
	@echo "  make check-licenses - Verify LICENSE, manifests and dependency licences"
	@echo "  make helm-lint      - Lint and render the Helm chart for all environments"
	@echo "  make install        - Install dependencies"
	@echo "  make build          - Build the contract"
	@echo "  make optimize       - Optimize the WASM binary"
	@echo "  make test           - Run tests"
	@echo "  make test-verbose   - Run tests with output"
	@echo "  make check          - Check code without building"
	@echo "  make fmt            - Format code"
	@echo "  make lint           - Lint code"
	@echo "  make clean          - Clean build artifacts"
	@echo "  make watch          - Watch for changes and rebuild"
	@echo "  make docs           - Generate documentation"
	@echo "  make audit          - Run security audit"
	@echo "  make size           - Show contract size"
	@echo ""
	@echo "Deployment:"
	@echo "  make setup-testnet  - Configure testnet"
	@echo "  make create-identity - Create deployer identity"
	@echo "  make fund-deployer  - Fund deployer account"
	@echo "  make deploy         - Deploy contract to testnet"
	@echo "  make initialize     - Initialize contract (requires CONTRACT_ID, USDC_TOKEN)"
	@echo "  make deploy-full    - Full deployment flow"
	@echo ""
	@echo "Example:"
	@echo "  make deploy-full"
	@echo "  make initialize CONTRACT_ID=CXXX... USDC_TOKEN=CYYY... FEE_BPS=250"
