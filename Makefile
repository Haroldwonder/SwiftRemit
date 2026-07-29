.PHONY: build test clean deploy install optimize check fmt dev dev-down verify

# Default target
all: build test

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

# Bring up the full local stack (postgres, jaeger, backend, api, frontend, prometheus, grafana).
# Backend/api containers auto-run migrations on boot (see backend/src/index.ts), and read
# their config from the workspace .env.example files via docker-compose's env_file, so no
# manual .env setup is required for a first run.
dev:
	@echo "🚀 Starting SwiftRemit local stack..."
	docker compose up --build -d
	@echo ""
	@echo "✅ Stack is up:"
	@echo "  frontend:   http://localhost:5173"
	@echo "  api:        http://localhost:3000"
	@echo "  backend:    http://localhost:3001"
	@echo "  jaeger:     http://localhost:16686"
	@echo "  prometheus: http://localhost:9090"
	@echo "  grafana:    http://localhost:3003 (admin/admin)"
	@echo ""
	@echo "Run 'docker compose logs -f' to follow logs, 'make dev-down' to stop."

# Stop and remove the local stack (data volumes are preserved).
dev-down:
	docker compose down

# Run the same checks CI runs, across every workspace. Requires a reachable Postgres for
# the backend test suite — run 'make dev' first, or set DATABASE_URL yourself.
verify:
	@echo "▶ Rust: fmt, clippy, test"
	cargo fmt --check
	cargo clippy -- -D warnings
	cargo test --verbose
	@echo "▶ backend: lint, typecheck, test"
	cd backend && npm run lint && npx tsc --noEmit
	cd backend && DATABASE_URL="$${DATABASE_URL:-postgres://swiftremit:swiftremit@localhost:5432/swiftremit}" npm test
	@echo "▶ api: lint, typecheck, test"
	cd api && npm run lint && npx tsc --noEmit && npm test
	@echo "▶ frontend: lint, typecheck"
	cd frontend && npm run lint && npx tsc --noEmit
	@echo "▶ sdk: lint, test"
	cd sdk && npm run lint && npm test
	@echo "✅ verify complete"

# Help
help:
	@echo "SwiftRemit Makefile Commands:"
	@echo ""
	@echo "Development:"
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
	@echo "Local stack:"
	@echo "  make dev            - Start the full local stack (docker compose)"
	@echo "  make dev-down       - Stop the local stack"
	@echo "  make verify         - Run lint, typecheck, and tests across every workspace"
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
