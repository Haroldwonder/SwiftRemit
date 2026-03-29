# Contributing to SwiftRemit

Thank you for your interest in contributing to SwiftRemit! This guide will help you get started with development, testing, and submitting contributions.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Environment Setup](#development-environment-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)
- [Community](#community)

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please be respectful and professional in all interactions.

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Rust** (latest stable): [Install Rust](https://www.rust-lang.org/tools/install)
- **Node.js** (v18 or v20): [Install Node.js](https://nodejs.org/)
- **Stellar CLI**: Install via `cargo install --locked stellar-cli`
- **PostgreSQL** (v15+): Required for backend services
- **Git**: [Install Git](https://git-scm.com/downloads)

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/SwiftRemit.git
   cd SwiftRemit
   ```

3. Add the upstream repository:
   ```bash
   git remote add upstream https://github.com/Haroldwonder/SwiftRemit.git
   ```

## Development Environment Setup

### 1. Smart Contract (Rust)

```bash
# Install wasm32 target
rustup target add wasm32-unknown-unknown

# Build the contract
cargo build --target wasm32-unknown-unknown --release

# Run tests
cargo test
```

### 2. Backend Service (Node.js/TypeScript)

```bash
cd backend

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# Set up PostgreSQL database

# Run database migrations
psql $DATABASE_URL -f migrations/webhook_schema.sql
psql $DATABASE_URL -f migrations/anchors_catalog_schema.sql
psql $DATABASE_URL -f migrations/kyc_status_schema.sql

# Start development server
npm run dev

# Run tests
npm test
```


### 3. API Service (Node.js/TypeScript)

```bash
cd api

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Start development server
npm run dev

# Run tests
npm test
```

### 4. Environment Configuration

Copy the example environment files and configure them:

```bash
# Root configuration
cp .env.example .env

# Backend configuration
cp backend/.env.example backend/.env

# API configuration
cp api/.env.example api/.env
```

See [CONFIGURATION.md](CONFIGURATION.md) for detailed configuration options.

## Project Structure

```
SwiftRemit/
├── src/                    # Rust smart contract source
│   ├── lib.rs             # Main contract implementation
│   ├── types.rs           # Data structures
│   ├── storage.rs         # Storage management
│   ├── errors.rs          # Error definitions
│   └── test.rs            # Contract tests
├── backend/               # Backend verification service
│   ├── src/               # TypeScript source
│   ├── migrations/        # Database migrations
│   └── __tests__/         # Backend tests
├── api/                   # API service
│   ├── src/               # TypeScript source
│   └── __tests__/         # API tests
├── examples/              # Example scripts and utilities
├── docs/                  # Additional documentation
└── .github/workflows/     # CI/CD workflows
```

## Development Workflow

### Branch Naming Conventions

Use descriptive branch names following these patterns:

- `feature/description` - New features
- `fix/description` - Bug fixes
- `refactor/description` - Code refactoring
- `docs/description` - Documentation updates
- `test/description` - Test additions or modifications
- `chore/description` - Maintenance tasks

Examples:
- `feature/multi-currency-support`
- `fix/fee-calculation-overflow`
- `docs/update-api-reference`

### Making Changes

1. Create a new branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes following the [coding standards](#coding-standards)

3. Write or update tests for your changes

4. Run the full test suite to ensure nothing breaks

5. Commit your changes with clear, descriptive messages

6. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

## Coding Standards

### Rust (Smart Contract)

- Follow the [Rust Style Guide](https://doc.rust-lang.org/nightly/style-guide/)
- Use `cargo fmt` to format code
- Use `cargo clippy` to catch common mistakes
- Add documentation comments (`///`) for public functions
- Keep functions focused and single-purpose
- Use descriptive variable names
- Handle errors explicitly, avoid unwrap() in production code

Example:
```rust
/// Creates a new remittance with the specified parameters.
///
/// # Arguments
/// * `sender` - The address initiating the remittance
/// * `agent` - The registered agent handling the payout
/// * `amount` - The amount in USDC (must be > 0)
///
/// # Errors
/// Returns `Error::InvalidAmount` if amount is 0
/// Returns `Error::AgentNotRegistered` if agent is not approved
pub fn create_remittance(
    env: Env,
    sender: Address,
    agent: Address,
    amount: i128,
) -> Result<u64, Error> {
    // Implementation
}
```

### TypeScript (Backend/API)

- Follow [TypeScript best practices](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
- Use ESLint for linting: `npm run lint`
- Use meaningful variable and function names
- Add JSDoc comments for exported functions
- Prefer `async/await` over raw promises
- Use strict TypeScript configuration
- Handle errors with try/catch blocks

Example:
```typescript
/**
 * Verifies an asset against multiple trusted sources
 * @param assetCode - The asset code (e.g., "USDC")
 * @param issuer - The issuer's public key
 * @returns Verification result with trust score
 */
export async function verifyAsset(
  assetCode: string,
  issuer: string
): Promise<VerificationResult> {
  // Implementation
}
```

### General Guidelines

- Write self-documenting code with clear names
- Keep functions small and focused (< 50 lines ideally)
- Avoid deep nesting (max 3-4 levels)
- Add comments for complex logic, not obvious code
- Remove commented-out code before committing
- No console.log() in production code (use proper logging)

## Testing

### Running Tests

#### Smart Contract Tests
```bash
# Run all Rust tests
cargo test

# Run tests with output
cargo test -- --nocapture

# Run specific test
cargo test test_name

# Run property-based tests
cargo test --features legacy-tests
```

#### Backend Tests
```bash
cd backend

# Run all tests
npm test

# Run specific test suite
npm run test:webhook

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm test -- --coverage
```

#### API Tests
```bash
cd api

# Run all tests
npm test

# Run integration tests
npm run test:integration

# Run in watch mode
npm run test:watch
```

### Writing Tests

- Write tests for all new features
- Include both positive and negative test cases
- Test edge cases and error conditions
- Use descriptive test names that explain what is being tested
- Keep tests isolated and independent

Example test structure:
```rust
#[test]
fn test_create_remittance_success() {
    // Arrange: Set up test environment
    let env = Env::default();
    // ... setup code
    
    // Act: Execute the function
    let result = create_remittance(env, sender, agent, amount);
    
    // Assert: Verify the outcome
    assert!(result.is_ok());
    assert_eq!(remittance.status, RemittanceStatus::Pending);
}
```

### Test Coverage Requirements

- New features should have >80% test coverage
- Bug fixes must include regression tests
- All public APIs must have tests
- Critical paths (payments, fees) require comprehensive testing

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks, dependency updates
- `perf`: Performance improvements
- `ci`: CI/CD changes

### Examples

```
feat(contract): add multi-currency support

Implement support for multiple stablecoins beyond USDC.
Adds token whitelisting and validation.

Closes #123
```

```
fix(backend): resolve webhook signature verification

Fix HMAC signature validation for anchor webhooks.
Previously failed due to incorrect header parsing.

Fixes #456
```

```
docs(readme): update deployment instructions

Add Windows PowerShell deployment steps and
troubleshooting section.
```

### Guidelines

- Use present tense ("add feature" not "added feature")
- Use imperative mood ("move cursor to..." not "moves cursor to...")
- First line should be ≤72 characters
- Reference issues and PRs in the footer
- Explain *what* and *why*, not *how*

## Pull Request Process

### Before Submitting

1. **Update your branch** with the latest upstream changes:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run all tests** and ensure they pass:
   ```bash
   cargo test                    # Rust tests
   cd backend && npm test        # Backend tests
   cd api && npm test            # API tests
   ```

3. **Run linters**:
   ```bash
   cargo clippy                  # Rust linter
   cargo fmt --check             # Rust formatter
   cd backend && npm run lint    # Backend linter
   cd api && npm run lint        # API linter
   ```

4. **Update documentation** if needed:
   - Update README.md for user-facing changes
   - Update API.md for API changes
   - Add/update code comments
   - Update CONFIGURATION.md for new config options

### Creating a Pull Request

1. Push your branch to your fork

2. Go to the [SwiftRemit repository](https://github.com/Haroldwonder/SwiftRemit)

3. Click "New Pull Request"

4. Select your fork and branch

5. Fill out the PR template with:
   - **Title**: Clear, descriptive title following commit message format
   - **Description**: What changes were made and why
   - **Related Issues**: Link to related issues (e.g., "Closes #123")
   - **Testing**: How you tested the changes
   - **Screenshots**: If applicable (UI changes)
   - **Checklist**: Complete the PR checklist

### PR Template

```markdown
## Description
Brief description of changes

## Related Issues
Closes #123

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] All tests pass locally
- [ ] Added new tests for changes
- [ ] Manual testing completed

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Tests added/updated
- [ ] All CI checks pass
```

### Review Process

1. **Automated Checks**: CI/CD will run automatically
   - Rust tests and build
   - TypeScript compilation
   - Linting and formatting
   - Test coverage
   - Security audit

2. **Code Review**: At least one maintainer will review
   - Code quality and style
   - Test coverage
   - Documentation
   - Security considerations
   - Performance implications

3. **Feedback**: Address review comments
   - Make requested changes
   - Push updates to the same branch
   - Respond to comments

4. **Approval**: Once approved, a maintainer will merge

### Required CI Checks

All PRs must pass:
- ✅ Rust Smart Contract CI (tests + WASM build)
- ✅ Webhook System CI (backend tests)
- ✅ Currency API CI (API tests)
- ✅ Environment Variable Validation
- ✅ Property-based Tests (if applicable)

## Issue Guidelines

### Creating an Issue

Before creating an issue:
1. Search existing issues to avoid duplicates
2. Check if it's already fixed in `main` branch
3. Gather relevant information (error messages, logs, versions)

### Issue Types

#### Bug Report

Use the bug report template and include:
- Clear, descriptive title
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment details (OS, Node version, Rust version)
- Error messages and logs
- Screenshots if applicable

Example:
```markdown
**Title**: Fee calculation overflow for large amounts

**Description**:
When creating a remittance with amount > 1,000,000 USDC,
the fee calculation overflows and panics.

**Steps to Reproduce**:
1. Call create_remittance with amount = 2,000,000
2. Observe panic in fee calculation

**Expected**: Fee calculated correctly
**Actual**: Panic with overflow error

**Environment**:
- OS: Ubuntu 22.04
- Rust: 1.75.0
- Soroban SDK: 21.7.0
```

#### Feature Request

Include:
- Clear description of the feature
- Use case and motivation
- Proposed solution (if any)
- Alternatives considered
- Additional context

#### Question

For questions:
- Check documentation first
- Search existing issues
- Provide context about what you're trying to achieve
- Include relevant code snippets

### Issue Labels

- `bug`: Something isn't working
- `feature`: New feature request
- `documentation`: Documentation improvements
- `good first issue`: Good for newcomers
- `help wanted`: Extra attention needed
- `priority: high/medium/low`: Priority level
- `status: in progress`: Being worked on
- `status: blocked`: Blocked by dependencies

## Community

### Getting Help

- **Documentation**: Check README.md and docs/ folder
- **GitHub Issues**: Search or create an issue
- **Stellar Discord**: Join the [Stellar Discord](https://discord.gg/stellar)
- **Discussions**: Use GitHub Discussions for questions

### Communication Channels

- GitHub Issues: Bug reports and feature requests
- GitHub Discussions: General questions and discussions
- Pull Requests: Code review and technical discussions

### Recognition

Contributors will be:
- Listed in release notes
- Credited in the repository
- Mentioned in project updates

## Additional Resources

- [README.md](README.md) - Project overview
- [DEPLOYMENT.md](DEPLOYMENT.md) - Deployment guide
- [CONFIGURATION.md](CONFIGURATION.md) - Configuration reference
- [API.md](API.md) - API documentation
- [Stellar Documentation](https://developers.stellar.org/)
- [Soroban Documentation](https://soroban.stellar.org/)
- [Rust Book](https://doc.rust-lang.org/book/)

## License

By contributing to SwiftRemit, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to SwiftRemit! 🚀
